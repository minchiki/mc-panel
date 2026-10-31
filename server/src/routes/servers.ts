import os from "node:os";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser, requireUser, serverAccess } from "../auth/guard.js";
import { findById } from "../auth/users.js";
import { recommendJava } from "../cores/java.js";
import { CORE_INFO, CORES, isCore, JAVA_VERSIONS } from "../cores/types.js";
import { listVersions } from "../cores/versions.js";
import { badRequest, conflict } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { serverDiskBytes } from "../servers/disk.js";
import { assertWithinOwnerLimits, createServer, deleteServer, reinstallServer } from "../servers/lifecycle.js";
import { getServer, listServersFor, ownerUsage, updateServer } from "../servers/repo.js";
import { killServer, restartServer, runtime, sendCommand, startServer, stopServer } from "../servers/runtime.js";
import { stopServerSchedules } from "../schedules/service.js";
import { auditServer, serverFor, serverView, type IdParams } from "./common.js";

const coreSchema = z.string().refine(isCore, "Неизвестное ядро");
const javaSchema = z.coerce.number().refine((v) => (JAVA_VERSIONS as readonly number[]).includes(v), "Неподдерживаемая версия Java");
const ramSchema = z.coerce.number().int().min(512, "RAM: минимум 512 МБ").max(32768);
const cpuSchema = z.coerce.number().min(0.25).max(16);
const diskSchema = z.coerce.number().int().min(1024, "Диск: минимум 1024 МБ").max(512_000);
const versionSchema = z.string().trim().min(1).max(64).regex(/^[\w.+-]+$/, "Неверная версия");

export async function serverRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/cores", { preHandler: requireUser }, async () => ({
    cores: CORES.map((c) => CORE_INFO[c]),
    java: JAVA_VERSIONS,
    hostRamMb: Math.round(os.totalmem() / 1048576),
  }));

  app.get<{ Params: { core: string } }>("/api/cores/:core/versions", { preHandler: requireUser }, async (req) => {
    if (!isCore(req.params.core)) throw badRequest("Неизвестное ядро");
    try {
      return { versions: await listVersions(req.params.core) };
    } catch (err) {
      throw conflict(`Не удалось получить список версий (${(err as Error).message}). Попробуйте позже.`);
    }
  });

  app.get<{ Params: { core: string }; Querystring: { version: string } }>(
    "/api/cores/:core/java",
    { preHandler: requireUser },
    async (req) => {
      if (!isCore(req.params.core)) throw badRequest("Неизвестное ядро");
      return { java: await recommendJava(req.params.core, String(req.query.version ?? "")) };
    },
  );

  app.get("/api/servers", { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    return { servers: listServersFor(user.id, user.role === "admin").map((s) => serverView(s, serverAccess(user, s.id))) };
  });

  app.post("/api/servers", { preHandler: requireUser }, async (req) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1, "Укажите название").max(48),
        core: coreSchema,
        mcVersion: versionSchema,
        build: versionSchema.optional(),
        java: javaSchema,
        ramMb: ramSchema,
        cpuLimit: cpuSchema,
        diskMb: diskSchema,
        port: z.coerce.number().int().optional(),
        ownerId: z.coerce.number().int().optional(),
        acceptEula: z.literal(true, { errorMap: () => ({ message: "Нужно принять Minecraft EULA" }) }),
      }),
      req.body,
    );
    const user = currentUser(req);
    const ownerId = user.role === "admin" && body.ownerId ? body.ownerId : user.id;
    const owner = findById(ownerId);
    if (!owner) throw badRequest("Владелец не найден");
    assertWithinOwnerLimits(owner, ownerUsage(owner.id), body.ramMb, true);
    if ((body.core === "forge" || body.core === "neoforge") && !body.build) throw badRequest("Выберите сборку загрузчика");
    const server = await createServer({ ...body, core: body.core as (typeof CORES)[number], ownerId });
    auditServer(req, server.id, "server.create", { core: body.core, version: body.mcVersion });
    return { server: serverView(server, serverAccess(user, server.id)) };
  });

  app.get<IdParams>("/api/servers/:id", { preHandler: requireUser }, async (req) => {
    const { server, access } = serverFor(req, "monitor");
    return { server: { ...serverView(server, access), diskUsedMb: Math.round((await serverDiskBytes(server.id)) / 1024 / 1024) } };
  });

  app.get<IdParams>("/api/servers/:id/console", { preHandler: requireUser }, async (req) => {
    serverFor(req, "console");
    return { lines: runtime(req.params.id).console };
  });

  app.patch<IdParams>("/api/servers/:id", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "settings");
    const user = currentUser(req);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(48).optional(),
        jvmFlags: z.string().max(2000).regex(/^[\w\s=:+.,/@%-]*$/, "Недопустимые символы в флагах JVM").optional(),
        autoRestart: z.boolean().optional(),
        javaVersion: javaSchema.optional(),
        // Resource limits are an owner/admin decision, not a sub-user one.
        ramMb: ramSchema.optional(),
        cpuLimit: cpuSchema.optional(),
        diskMb: diskSchema.optional(),
      }),
      req.body,
    );
    const changesLimits = body.ramMb !== undefined || body.cpuLimit !== undefined || body.diskMb !== undefined;
    if (changesLimits) {
      serverFor(req, "owner");
      const owner = findById(server.owner_id)!;
      if (user.role !== "admin") {
        if (body.diskMb !== undefined || body.cpuLimit !== undefined) throw conflict("CPU и диск меняет только администратор");
        assertWithinOwnerLimits(owner, ownerUsage(owner.id), (body.ramMb ?? server.ram_mb) - server.ram_mb, false);
      }
    }
    const updated = updateServer(server.id, {
      name: body.name,
      jvm_flags: body.jvmFlags,
      auto_restart: body.autoRestart === undefined ? undefined : body.autoRestart ? 1 : 0,
      java_version: body.javaVersion,
      ram_mb: body.ramMb,
      cpu_limit: body.cpuLimit,
      disk_mb: body.diskMb,
    });
    auditServer(req, server.id, "server.update", body);
    return { server: serverView(updated), restartNeeded: runtime(server.id).status === "online" };
  });

  app.post<IdParams & { Body: { action: string } }>("/api/servers/:id/power", { preHandler: requireUser }, async (req) => {
    serverFor(req, "power");
    const { action } = parse(z.object({ action: z.enum(["start", "stop", "restart", "kill"]) }), req.body);
    const id = req.params.id;
    auditServer(req, id, `server.${action}`);
    // Long operations continue in the background; the UI follows status over WebSocket.
    const ops = { start: startServer, stop: stopServer, restart: restartServer, kill: killServer };
    const op = ops[action](id);
    if (action === "start" || action === "kill") await op;
    else op.catch((err) => runtime(id).panel(`Ошибка: ${(err as Error).message}`));
    return { status: runtime(id).status };
  });

  app.post<IdParams>("/api/servers/:id/command", { preHandler: requireUser, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    serverFor(req, "console");
    const { command } = parse(z.object({ command: z.string().min(1).max(1000) }), req.body);
    sendCommand(req.params.id, command);
    auditServer(req, req.params.id, "server.command", { command });
    return { ok: true };
  });

  app.post<IdParams>("/api/servers/:id/reinstall", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "owner");
    const body = parse(
      z.object({ core: coreSchema, mcVersion: versionSchema, build: versionSchema.optional(), java: javaSchema, backupFirst: z.boolean().default(true) }),
      req.body,
    );
    auditServer(req, server.id, "server.reinstall", body);
    reinstallServer(server.id, { ...body, core: body.core as (typeof CORES)[number] }).catch((err) =>
      runtime(server.id).panel(`Переустановка не удалась: ${(err as Error).message}`),
    );
    return { ok: true };
  });

  app.delete<IdParams>("/api/servers/:id", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "owner");
    const { confirm } = parse(z.object({ confirm: z.string() }), req.body ?? {});
    if (confirm !== server.name) throw badRequest("Введите название сервера для подтверждения");
    stopServerSchedules(server.id);
    await deleteServer(server.id);
    auditServer(req, server.id, "server.delete", { name: server.name });
    return { ok: true };
  });

  app.get<IdParams>("/api/servers/:id/owner-limits", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "monitor");
    const owner = findById(getServer(server.id).owner_id)!;
    return { maxRamMb: owner.max_ram_mb, usedRamMb: ownerUsage(owner.id).ramMb };
  });
}
