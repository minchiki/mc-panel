import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/guard.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { getPackJob, installedPack, playerPackPath, savePackFromUrl, savePackUpload, startPackInstall } from "../plugins/mrpack.js";
import { auditServer, serverFor, type IdParams } from "./common.js";

export async function mrpackRoutes(app: FastifyInstance): Promise<void> {
  // Step 1: upload (or link) a pack and see what it needs. Used by the create wizard and the Mods tab.
  app.post("/api/mrpack/upload", { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req) => {
    const user = currentUser(req);
    const part = await req.file();
    if (!part) throw badRequest("Файл не получен");
    const info = await savePackUpload(part.file, part.filename, user.id);
    audit({ userId: user.id, action: "mrpack.upload", details: { name: info.name, version: info.version }, ip: req.ip });
    return { pack: info };
  });

  app.post("/api/mrpack/url", { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req) => {
    const user = currentUser(req);
    const { url } = parse(z.object({ url: z.string().trim().min(10).max(1000) }), req.body);
    const info = await savePackFromUrl(url, user.id);
    audit({ userId: user.id, action: "mrpack.url", details: { name: info.name, version: info.version }, ip: req.ip });
    return { pack: info };
  });

  // Step 2: install it onto a server. Changes the core/version, so it is an owner-level action.
  app.post<IdParams>("/api/servers/:id/mrpack", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "owner");
    const body = parse(
      z.object({ packId: z.string().regex(/^[a-z0-9]{12}$/), backupFirst: z.boolean().default(true), clearMods: z.boolean().default(true) }),
      req.body,
    );
    const job = await startPackInstall(server, body.packId, currentUser(req), { backupFirst: body.backupFirst, clearMods: body.clearMods });
    auditServer(req, server.id, "mrpack.install", { pack: job.pack, backupFirst: body.backupFirst, clearMods: body.clearMods });
    return { job };
  });

  app.get<IdParams>("/api/servers/:id/mrpack", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "plugins");
    const installed = await installedPack(server.id);
    const forPlayers = await stat(playerPackPath(server.id)).catch(() => null);
    return {
      job: getPackJob(server.id),
      installed: installed && { name: installed.name, version: installed.version, core: installed.core, mcVersion: installed.mcVersion, installedAt: installed.installedAt },
      playerPack: forPlayers ? { size: forPlayers.size } : null,
    };
  });

  // The same .mrpack for players: import it in the Modrinth App, Prism Launcher or ATLauncher.
  app.get<IdParams>("/api/servers/:id/mrpack/download", { preHandler: requireUser }, async (req, reply) => {
    const { server } = serverFor(req, "monitor");
    const path = playerPackPath(server.id);
    const s = await stat(path).catch(() => null);
    if (!s) throw notFound("Сборка для игроков");
    const installed = await installedPack(server.id);
    const name = `${installed?.name ?? server.name} ${installed?.version ?? ""}`.trim().replace(/[^\p{L}\p{N} ._-]/gu, "_");
    reply.header("Content-Type", "application/x-modrinth-modpack+zip");
    reply.header("Content-Length", s.size);
    reply.header("Content-Disposition", `attachment; filename="pack.mrpack"; filename*=UTF-8''${encodeURIComponent(name)}.mrpack`);
    return reply.send(createReadStream(path));
  });
}
