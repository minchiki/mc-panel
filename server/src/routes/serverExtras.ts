import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { requireUser } from "../auth/guard.js";
import {
  backupPath,
  createBackup,
  deleteBackup,
  getBackup,
  getBackupSettings,
  listBackups,
  restoreBackup,
  setBackupSettings,
} from "../backups/service.js";
import { connectionInfo, createDatabase, deleteDatabase, listDatabases, rotatePassword } from "../databases/service.js";
import { badRequest, conflict } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { deleteAddon, installFromCatalog, SOURCES, listInstalled, safeJarName, searchCatalog, setAddonEnabled, sourcesFor, addonsDir } from "../plugins/catalog.js";
import { deleteSchedule, listSchedules, nextRuns, runSchedule, saveSchedule, SCHEDULE_ACTIONS, validateCron } from "../schedules/service.js";
import { CORE_INFO } from "../cores/types.js";
import { saveUpload } from "../files/service.js";
import { dataDirOf } from "../servers/repo.js";
import { runtime } from "../servers/runtime.js";
import { relative } from "node:path";
import { attachment } from "./files.js";
import { auditServer, serverFor, type IdParams } from "./common.js";

type SubParams = { Params: { id: string; sub: string } };

export async function serverExtraRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------- backups
  app.get<IdParams>("/api/servers/:id/backups", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "backups");
    return { backups: listBackups(server.id), settings: getBackupSettings(server.id) };
  });

  app.post<IdParams>("/api/servers/:id/backups", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "backups");
    const { name } = parse(z.object({ name: z.string().trim().max(80).default("") }), req.body ?? {});
    auditServer(req, server.id, "backup.create", { name });
    createBackup(server.id, name || `Ручной ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`).catch(() => undefined);
    return { ok: true };
  });

  app.put<IdParams>("/api/servers/:id/backups/settings", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "backups");
    const body = parse(z.object({ max_count: z.number().int().min(1).max(50), excludes: z.string().max(2000) }), req.body);
    setBackupSettings(server.id, body);
    return { ok: true };
  });

  app.get<SubParams>("/api/servers/:id/backups/:sub/download", { preHandler: requireUser }, async (req, reply) => {
    const { server } = serverFor(req, "backups");
    const b = getBackup(server.id, req.params.sub);
    const path = backupPath(b);
    const st = await stat(path);
    reply.header("Content-Type", "application/gzip");
    reply.header("Content-Length", st.size);
    reply.header("Content-Disposition", attachment(`${server.name}-${b.file}`));
    return reply.send(createReadStream(path));
  });

  app.post<SubParams>("/api/servers/:id/backups/:sub/restore", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "backups");
    auditServer(req, server.id, "backup.restore", { backup: req.params.sub });
    restoreBackup(server.id, req.params.sub).catch(() => undefined);
    return { ok: true };
  });

  app.delete<SubParams>("/api/servers/:id/backups/:sub", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "backups");
    await deleteBackup(server.id, req.params.sub);
    auditServer(req, server.id, "backup.delete", { backup: req.params.sub });
    return { ok: true };
  });

  // ---------------------------------------------------------- schedules
  app.get<IdParams>("/api/servers/:id/schedules", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "schedules");
    return { schedules: listSchedules(server.id), actions: SCHEDULE_ACTIONS };
  });

  app.post<IdParams>("/api/servers/:id/schedules/preview", { preHandler: requireUser }, async (req) => {
    serverFor(req, "schedules");
    const { cron } = parse(z.object({ cron: z.string().max(100) }), req.body);
    validateCron(cron);
    return { next: nextRuns(cron, 3) };
  });

  app.post<IdParams>("/api/servers/:id/schedules", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "schedules");
    const body = parse(
      z.object({
        id: z.number().int().optional(),
        name: z.string().trim().min(1).max(64),
        cron: z.string().trim().min(1).max(100),
        action: z.enum(SCHEDULE_ACTIONS),
        payload: z.string().max(500).regex(/^[^\r\n]*$/, "Без переносов строк").default(""),
        enabled: z.boolean().default(true),
      }),
      req.body,
    );
    if ((body.action === "command" || body.action === "broadcast") && !body.payload) throw badRequest("Укажите команду или текст");
    const row = saveSchedule(server.id, body);
    auditServer(req, server.id, "schedule.save", { name: body.name, cron: body.cron, action: body.action });
    return { schedule: row };
  });

  app.post<SubParams>("/api/servers/:id/schedules/:sub/run", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "schedules");
    const id = Number(req.params.sub);
    if (!listSchedules(server.id).some((s) => s.id === id)) throw badRequest("Задача не найдена");
    void runSchedule(id);
    return { ok: true };
  });

  app.delete<SubParams>("/api/servers/:id/schedules/:sub", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "schedules");
    deleteSchedule(server.id, Number(req.params.sub));
    auditServer(req, server.id, "schedule.delete", { id: req.params.sub });
    return { ok: true };
  });

  // ---------------------------------------------------------- plugins / mods
  app.get<IdParams>("/api/servers/:id/addons", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "plugins");
    return { dir: CORE_INFO[server.core].addons.dir, sources: sourcesFor(server.core), installed: await listInstalled(server) };
  });

  app.get<IdParams & { Querystring: { source?: string; q?: string; page?: string } }>(
    "/api/servers/:id/addons/search",
    { preHandler: requireUser },
    async (req) => {
      const { server } = serverFor(req, "plugins");
      const source = z.enum(SOURCES).parse(req.query.source ?? "modrinth");
      try {
        return { items: await searchCatalog(server, source, String(req.query.q ?? "").slice(0, 100), Math.max(0, Number(req.query.page) || 0)) };
      } catch (err) {
        throw conflict(`Каталог недоступен: ${(err as Error).message}`);
      }
    },
  );

  app.post<IdParams>("/api/servers/:id/addons/install", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "plugins");
    const body = parse(z.object({ source: z.enum(SOURCES), id: z.string().min(1).max(100) }), req.body);
    const file = await installFromCatalog(server, body.source, body.id);
    auditServer(req, server.id, "addon.install", { ...body, file });
    return { file, restartNeeded: runtime(server.id).status === "online" };
  });

  app.post<IdParams>("/api/servers/:id/addons/upload", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "plugins");
    const dir = relative(dataDirOf(server.id), await addonsDir(server));
    const files: string[] = [];
    for await (const part of req.files()) {
      if (!part.filename.toLowerCase().endsWith(".jar")) throw badRequest("Можно загружать только .jar");
      const name = safeJarName(part.filename);
      await saveUpload(server.id, dir, name, part.file);
      files.push(name);
    }
    auditServer(req, server.id, "addon.upload", { files });
    return { files };
  });

  app.post<IdParams>("/api/servers/:id/addons/toggle", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "plugins");
    const body = parse(z.object({ file: z.string().min(1).max(255), enabled: z.boolean() }), req.body);
    await setAddonEnabled(server, body.file, body.enabled);
    auditServer(req, server.id, "addon.toggle", body);
    return { ok: true };
  });

  app.post<IdParams>("/api/servers/:id/addons/delete", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "plugins");
    const { file } = parse(z.object({ file: z.string().min(1).max(255) }), req.body);
    await deleteAddon(server, file);
    auditServer(req, server.id, "addon.delete", { file });
    return { ok: true };
  });

  // ---------------------------------------------------------- databases
  app.get<IdParams>("/api/servers/:id/databases", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "databases");
    return { databases: listDatabases(server.id).map((d) => ({ id: d.id, name: d.name, username: d.username, createdAt: d.created_at })) };
  });

  app.get<SubParams>("/api/servers/:id/databases/:sub/credentials", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "databases");
    const db = listDatabases(server.id).find((d) => d.id === Number(req.params.sub));
    if (!db) throw badRequest("База не найдена");
    auditServer(req, server.id, "database.reveal", { name: db.name });
    return connectionInfo(db);
  });

  app.post<IdParams>("/api/servers/:id/databases", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "databases");
    const { name } = parse(z.object({ name: z.string().trim().max(16).regex(/^[a-zA-Z0-9_]*$/, "Только латиница, цифры и _") }), req.body);
    const db = await createDatabase(server.id, name);
    auditServer(req, server.id, "database.create", { name: db.name });
    return { id: db.id, restartNeeded: runtime(server.id).status === "online" };
  });

  app.post<SubParams>("/api/servers/:id/databases/:sub/rotate", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "databases");
    await rotatePassword(server.id, Number(req.params.sub));
    auditServer(req, server.id, "database.rotate", { id: req.params.sub });
    return { ok: true };
  });

  app.delete<SubParams>("/api/servers/:id/databases/:sub", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "databases");
    await deleteDatabase(server.id, Number(req.params.sub));
    auditServer(req, server.id, "database.delete", { id: req.params.sub });
    return { ok: true };
  });
}
