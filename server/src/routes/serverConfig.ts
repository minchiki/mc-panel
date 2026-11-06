import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { requireUser } from "../auth/guard.js";
import { isPermission, SERVER_PERMISSIONS } from "../auth/permissions.js";
import { findByUsername } from "../auth/users.js";
import { all, run } from "../db/index.js";
import { listAudit } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { resolveExisting, writeNoFollow } from "../lib/paths.js";
import { applyUpdates, parseProperties, serializeProperties, toRecord } from "../lib/properties.js";
import { parse } from "../lib/validate.js";
import { metricsHistory } from "../servers/metrics.js";
import { knownPlayers, playerHistory } from "../servers/players.js";
import { usesServerProperties } from "../servers/prepare.js";
import { allocatePort, dataDirOf, updateServer } from "../servers/repo.js";
import { runtime, sendCommand } from "../servers/runtime.js";
import { auditServer, serverFor, serverView, type IdParams } from "./common.js";

/** Keys the panel manages itself; editing them would break port mapping or RCON. */
const MANAGED_KEYS = new Set(["server-port", "query.port", "enable-rcon", "rcon.port", "rcon.password", "broadcast-rcon-to-ops"]);
const PLAYER = /^[A-Za-z0-9_.]{1,16}$/;
const IP = /^(\d{1,3}\.){3}\d{1,3}$/;

async function readJsonList(serverId: string, file: string): Promise<unknown[]> {
  try {
    const path = await resolveExisting(dataDirOf(serverId), file);
    const data = JSON.parse(await readFile(path, "utf8")) as unknown;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

const RANGES: Record<string, number> = { "1h": 3600_000, "6h": 6 * 3600_000, "24h": 24 * 3600_000, "7d": 7 * 24 * 3600_000 };

export async function serverConfigRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------- server.properties
  app.get<IdParams>("/api/servers/:id/properties", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "settings");
    if (!usesServerProperties(server.core)) return { supported: false, values: {} };
    const text = await resolveExisting(dataDirOf(server.id), "server.properties")
      .then((p) => readFile(p, "utf8"))
      .catch(() => "");
    const values = toRecord(parseProperties(text));
    for (const k of MANAGED_KEYS) delete values[k];
    return { supported: true, values };
  });

  app.put<IdParams>("/api/servers/:id/properties", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "settings");
    if (!usesServerProperties(server.core)) throw badRequest("У этого ядра нет server.properties");
    const { values } = parse(z.object({ values: z.record(z.string(), z.string().max(4000)) }), req.body);
    const updates: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (!/^[a-z0-9.-]{1,64}$/.test(key)) throw badRequest(`Недопустимый ключ: ${key}`);
      if (MANAGED_KEYS.has(key)) continue;
      updates[key] = value;
    }
    const path = join(dataDirOf(server.id), "server.properties");
    const text = await resolveExisting(dataDirOf(server.id), "server.properties")
      .then((p) => readFile(p, "utf8"))
      .catch(() => "");
    await writeNoFollow(path, serializeProperties(applyUpdates(parseProperties(text), updates)));
    auditServer(req, server.id, "server.properties", { keys: Object.keys(updates) });
    return { ok: true, restartNeeded: runtime(server.id).status === "online" };
  });

  // ---------------------------------------------------------- players
  app.get<IdParams>("/api/servers/:id/players", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "players");
    const [whitelist, ops, bannedPlayers, bannedIps] = await Promise.all(
      ["whitelist.json", "ops.json", "banned-players.json", "banned-ips.json"].map((f) => readJsonList(server.id, f)),
    );
    return {
      online: [...runtime(server.id).players],
      known: knownPlayers(server.id),
      history: playerHistory(server.id, 100),
      whitelist,
      ops,
      bannedPlayers,
      bannedIps,
    };
  });

  app.post<IdParams>("/api/servers/:id/players/action", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "players");
    const body = parse(
      z.object({
        action: z.enum(["kick", "ban", "pardon", "op", "deop", "whitelist-add", "whitelist-remove", "ban-ip", "pardon-ip", "whitelist-on", "whitelist-off"]),
        target: z.string().max(64).default(""),
        reason: z.string().max(200).regex(/^[^\n\r]*$/).optional(),
      }),
      req.body,
    );
    const isIpAction = body.action === "ban-ip" || body.action === "pardon-ip";
    const needsTarget = !body.action.startsWith("whitelist-o");
    if (needsTarget && !(isIpAction ? IP.test(body.target) || PLAYER.test(body.target) : PLAYER.test(body.target))) {
      throw badRequest("Некорректный ник или IP");
    }
    const reason = body.reason ? ` ${body.reason}` : "";
    const commands: Record<typeof body.action, string> = {
      kick: `kick ${body.target}${reason}`,
      ban: `ban ${body.target}${reason}`,
      pardon: `pardon ${body.target}`,
      op: `op ${body.target}`,
      deop: `deop ${body.target}`,
      "whitelist-add": `whitelist add ${body.target}`,
      "whitelist-remove": `whitelist remove ${body.target}`,
      "ban-ip": `ban-ip ${body.target}${reason}`,
      "pardon-ip": `pardon-ip ${body.target}`,
      "whitelist-on": "whitelist on",
      "whitelist-off": "whitelist off",
    };
    if (runtime(server.id).status !== "online") throw conflict("Запустите сервер: изменения применяются через консоль игры");
    sendCommand(server.id, commands[body.action]);
    auditServer(req, server.id, `players.${body.action}`, { target: body.target });
    return { ok: true };
  });

  // ---------------------------------------------------------- network
  app.patch<IdParams>("/api/servers/:id/network", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "network");
    const body = parse(
      z.object({
        port: z.coerce.number().int().optional(),
        domain: z
          .string()
          .trim()
          .toLowerCase()
          .max(253)
          .regex(/^$|^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Некорректный домен")
          .optional(),
      }),
      req.body,
    );
    const patch: { port?: number; domain?: string | null } = {};
    if (body.port !== undefined && body.port !== server.port) patch.port = allocatePort(body.port);
    if (body.domain !== undefined) patch.domain = body.domain || null;
    const updated = updateServer(server.id, patch);
    auditServer(req, server.id, "server.network", patch);
    return { server: serverView(updated), restartNeeded: patch.port !== undefined && runtime(server.id).status !== "offline" };
  });

  // ---------------------------------------------------------- sub-users
  app.get<IdParams>("/api/servers/:id/subusers", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "owner");
    return {
      available: SERVER_PERMISSIONS,
      subusers: all<{ user_id: number; username: string; permissions: string }>(
        "SELECT su.user_id, u.username, su.permissions FROM subusers su JOIN users u ON u.id = su.user_id WHERE su.server_id = ?",
        server.id,
      ).map((s) => ({ userId: s.user_id, username: s.username, permissions: s.permissions.split(",").filter(Boolean) })),
    };
  });

  app.put<IdParams>("/api/servers/:id/subusers", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "owner");
    const body = parse(z.object({ username: z.string().trim().min(1).max(32), permissions: z.array(z.string()).max(20) }), req.body);
    const user = findByUsername(body.username);
    if (!user) throw notFound("Пользователь");
    if (user.id === server.owner_id) throw badRequest("Это владелец сервера");
    const perms = body.permissions.filter(isPermission);
    run(
      `INSERT INTO subusers (server_id, user_id, permissions) VALUES (?, ?, ?)
       ON CONFLICT(server_id, user_id) DO UPDATE SET permissions = excluded.permissions`,
      server.id,
      user.id,
      perms.join(","),
    );
    auditServer(req, server.id, "subuser.save", { username: user.username, permissions: perms });
    return { ok: true };
  });

  app.delete<{ Params: { id: string; userId: string } }>("/api/servers/:id/subusers/:userId", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "owner");
    run("DELETE FROM subusers WHERE server_id = ? AND user_id = ?", server.id, Number(req.params.userId));
    auditServer(req, server.id, "subuser.delete", { userId: req.params.userId });
    return { ok: true };
  });

  // ---------------------------------------------------------- monitoring & activity
  app.get<IdParams & { Querystring: { range?: string } }>("/api/servers/:id/metrics", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "monitor");
    const range = RANGES[req.query.range ?? "1h"] ?? RANGES["1h"]!;
    return { points: metricsHistory(server.id, range), live: runtime(server.id).stats, tps: runtime(server.id).tps };
  });

  app.get<IdParams & { Querystring: { before?: string } }>("/api/servers/:id/activity", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "owner");
    return { entries: listAudit({ serverId: server.id, before: req.query.before ? Number(req.query.before) : undefined }) };
  });
}
