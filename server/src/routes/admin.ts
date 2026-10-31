import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { currentUser, requireAdmin } from "../auth/guard.js";
import { deleteUserSessions } from "../auth/sessions.js";
import { createUser, deleteUser, getUser, listUsers, setPassword, toPublic, updateUser } from "../auth/users.js";
import { passwordSchema, usernameSchema } from "../auth/routes.js";
import { config } from "../config.js";
import { run } from "../db/index.js";
import { docker } from "../docker/client.js";
import { audit, listAudit } from "../lib/audit.js";
import { badRequest } from "../lib/errors.js";
import { probe } from "../lib/http.js";
import { sendTestNotification } from "../lib/notify.js";
import { getSettings, updateSettings } from "../lib/settings.js";
import { checkForUpdate } from "../lib/updateCheck.js";
import { parse } from "../lib/validate.js";
import { hostDisk } from "../servers/disk.js";
import { listAllServers } from "../servers/repo.js";
import { runtime } from "../servers/runtime.js";

const execFileAsync = promisify(execFile);
const LOG_UNITS = ["mc-panel", "docker", "nginx", "fail2ban", "ssh"] as const;

let lastCpu = os.cpus();
function cpuPercent(): number {
  const now = os.cpus();
  let idle = 0;
  let total = 0;
  now.forEach((c, i) => {
    const prev = lastCpu[i]?.times ?? c.times;
    const t = c.times;
    const dTotal = t.user + t.nice + t.sys + t.idle + t.irq - (prev.user + prev.nice + prev.sys + prev.idle + prev.irq);
    idle += t.idle - prev.idle;
    total += dTotal;
  });
  lastCpu = now;
  return total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/overview", { preHandler: requireAdmin }, async () => {
    const disk = await hostDisk(config.SERVERS_DIR);
    const servers = listAllServers();
    const containers = await docker.listContainers({ all: true, filters: { label: ["mc-panel.server"] } }).catch(() => []);
    const version = await readFile(join(process.cwd(), "VERSION"), "utf8").catch(() => "dev");
    return {
      host: {
        hostname: os.hostname(),
        uptimeSec: os.uptime(),
        load: os.loadavg(),
        cpus: os.cpus().length,
        cpuPercent: cpuPercent(),
        memTotal: os.totalmem(),
        memFree: os.freemem(),
        diskTotal: disk.totalBytes,
        diskFree: disk.freeBytes,
      },
      servers: {
        total: servers.length,
        online: servers.filter((s) => runtime(s.id).status === "online").length,
        allocatedRamMb: servers.reduce((a, s) => a + s.ram_mb, 0),
        containers: containers.length,
      },
      users: listUsers().length,
      version: version.trim(),
    };
  });

  // ---------------------------------------------------------- users
  app.get("/api/admin/users", { preHandler: requireAdmin }, async () => {
    const servers = listAllServers();
    return {
      users: listUsers().map((u) => ({ ...toPublic(u), servers: servers.filter((s) => s.owner_id === u.id).length })),
    };
  });

  app.post("/api/admin/users", { preHandler: requireAdmin }, async (req) => {
    const body = parse(
      z.object({
        username: usernameSchema,
        email: z.string().email().optional().or(z.literal("")),
        password: passwordSchema,
        role: z.enum(["admin", "user"]),
        maxServers: z.number().int().min(0).max(100).default(3),
        maxRamMb: z.number().int().min(0).max(262144).default(4096),
      }),
      req.body,
    );
    const user = await createUser({ username: body.username, email: body.email || null, password: body.password, role: body.role });
    updateUser(user.id, { maxServers: body.maxServers, maxRamMb: body.maxRamMb });
    audit({ userId: currentUser(req).id, action: "admin.user_create", details: { username: user.username, role: body.role }, ip: req.ip });
    return { user: toPublic(getUser(user.id)) };
  });

  app.patch<{ Params: { id: string } }>("/api/admin/users/:id", { preHandler: requireAdmin }, async (req) => {
    const id = Number(req.params.id);
    const body = parse(
      z.object({
        role: z.enum(["admin", "user"]).optional(),
        maxServers: z.number().int().min(0).max(100).optional(),
        maxRamMb: z.number().int().min(0).max(262144).optional(),
        disabled: z.boolean().optional(),
        password: passwordSchema.optional(),
        resetTotp: z.boolean().optional(),
      }),
      req.body,
    );
    if (id === currentUser(req).id && (body.role === "user" || body.disabled)) throw badRequest("Нельзя понизить или отключить самого себя");
    const user = updateUser(id, body);
    if (body.password) {
      await setPassword(id, body.password);
      deleteUserSessions(id);
    }
    if (body.disabled) deleteUserSessions(id);
    if (body.resetTotp) {
      run("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?", id);
    }
    audit({
      userId: currentUser(req).id,
      action: "admin.user_update",
      details: { id, ...body, password: body.password ? "***" : undefined },
      ip: req.ip,
    });
    return { user: toPublic(getUser(user.id)) };
  });

  app.delete<{ Params: { id: string } }>("/api/admin/users/:id", { preHandler: requireAdmin }, async (req) => {
    const id = Number(req.params.id);
    if (id === currentUser(req).id) throw badRequest("Нельзя удалить самого себя");
    const username = getUser(id).username;
    deleteUser(id);
    audit({ userId: currentUser(req).id, action: "admin.user_delete", details: { username }, ip: req.ip });
    return { ok: true };
  });

  // ---------------------------------------------------------- audit, logs
  app.get<{ Querystring: { before?: string; serverId?: string } }>("/api/admin/audit", { preHandler: requireAdmin }, async (req) => ({
    entries: listAudit({
      before: req.query.before ? Number(req.query.before) : undefined,
      serverId: req.query.serverId || undefined,
      limit: 100,
    }),
  }));

  app.get<{ Querystring: { unit?: string; lines?: string } }>("/api/admin/logs", { preHandler: requireAdmin }, async (req) => {
    const unit = z.enum(LOG_UNITS).parse(req.query.unit ?? "mc-panel");
    const lines = Math.min(Math.max(Number(req.query.lines) || 200, 10), 2000);
    try {
      const { stdout } = await execFileAsync("journalctl", ["-u", unit, "-n", String(lines), "--no-pager", "-o", "short-iso"], {
        timeout: 15_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      return { unit, units: LOG_UNITS, text: stdout };
    } catch (err) {
      return { unit, units: LOG_UNITS, text: `Не удалось прочитать журнал: ${(err as Error).message}` };
    }
  });

  // ---------------------------------------------------------- settings
  app.get("/api/admin/settings", { preHandler: requireAdmin }, async () => {
    const s = getSettings();
    return {
      settings: {
        ...s,
        telegramBotToken: s.telegramBotToken ? "••••••" : "",
        telegramRelayKey: s.telegramRelayKey ? "••••••" : "",
        curseforgeApiKey: s.curseforgeApiKey ? "••••••" : "",
      },
    };
  });

  app.put("/api/admin/settings", { preHandler: requireAdmin }, async (req) => {
    const body = parse(
      z.object({
        registrationEnabled: z.boolean().optional(),
        accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        panelName: z.string().trim().min(1).max(40).optional(),
        telegramBotToken: z.string().max(100).regex(/^$|^\d+:[\w-]+$|^••••••$/, "Неверный формат токена").optional(),
        telegramChatId: z.string().max(40).regex(/^$|^-?\d+$|^@\w+$/, "Неверный chat id").optional(),
        telegramApiBase: z.string().trim().max(200).regex(/^$|^https:\/\/[^\s]+$/, "Адрес должен начинаться с https://").optional(),
        telegramRelayKey: z.string().trim().max(100).regex(/^[^\s]*$|^••••••$/, "Ключ не должен содержать пробелов").optional(),
        discordWebhook: z.string().max(300).regex(/^$|^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//, "Это не webhook Discord").optional(),
        notifyEvents: z
          .object({
            started: z.boolean(),
            stopped: z.boolean(),
            crash: z.boolean(),
            backupOk: z.boolean(),
            backupFailed: z.boolean(),
            disk: z.boolean(),
          })
          .partial()
          .optional(),
        diskAlertPercent: z.number().int().min(50).max(99).optional(),
        curseforgeApiKey: z.string().trim().max(200).regex(/^[^\s]*$|^••••••$/, "Ключ не должен содержать пробелов").optional(),
      }),
      req.body,
    );
    // The masked placeholder means "keep the stored token".
    if (body.telegramBotToken === "••••••") delete body.telegramBotToken;
    if (body.telegramRelayKey === "••••••") delete body.telegramRelayKey;
    if (body.curseforgeApiKey === "••••••") delete body.curseforgeApiKey;
    updateSettings(body);
    audit({ userId: currentUser(req).id, action: "admin.settings", details: Object.keys(body), ip: req.ip });
    return { ok: true };
  });

  app.post("/api/admin/settings/test-notification", { preHandler: requireAdmin }, async () => sendTestNotification());

  // Reachability of the upstreams the panel downloads from, one raw attempt each.
  const NET_TARGETS = [
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    "https://meta.fabricmc.net/v2/versions/game",
    "https://fill.papermc.io/v3/projects/paper",
    "https://api.purpurmc.org/v2/purpur",
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
    "https://maven.neoforged.net/",
    "https://api.modrinth.com/v2/",
    "https://hangar.papermc.io/api/v1/projects",
  ];
  app.get("/api/admin/network-check", { preHandler: requireAdmin }, async () => ({
    results: await Promise.all(NET_TARGETS.map((u) => probe(u))),
  }));

  // ---------------------------------------------------------- self-update
  // The panel has no root rights; it drops a flag file that a root-owned
  // systemd path unit (mc-panel-update.path) watches.
  app.post("/api/admin/update", { preHandler: requireAdmin }, async (req) => {
    await writeFile(join(config.DATA_DIR, "update-requested"), new Date().toISOString());
    audit({ userId: currentUser(req).id, action: "admin.update_requested", ip: req.ip });
    return { ok: true };
  });

  app.get("/api/admin/update/check", { preHandler: requireAdmin }, async () => {
    const current = await readFile(join(process.cwd(), "VERSION"), "utf8").then((v) => v.split("\n")[0]?.trim() ?? "", () => "");
    return checkForUpdate(current);
  });

  app.get("/api/admin/update/status", { preHandler: requireAdmin }, async () => {
    const log = await readFile(join(config.LOG_DIR, "update.log"), "utf8").catch(() => "");
    return { log: log.split("\n").slice(-60).join("\n") };
  });
}
