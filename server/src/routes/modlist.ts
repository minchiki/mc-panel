import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { z } from "zod";
import { requireUser } from "../auth/guard.js";
import { notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { clientZipInfo, clientZipPath, getBuildJob, getPreset, resolveModList, runBuild, setPresetAutoUpdate } from "../plugins/modlist.js";
import { attachment } from "./files.js";
import { auditServer, serverFor, type IdParams } from "./common.js";

export async function modlistRoutes(app: FastifyInstance): Promise<void> {
  app.post<IdParams>("/api/servers/:id/modlist/resolve", { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { server } = serverFor(req, "plugins");
    const { text } = parse(z.object({ text: z.string().max(20_000) }), req.body);
    return { rows: await resolveModList(server, text) };
  });

  app.post<IdParams>("/api/servers/:id/modlist/build", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "plugins");
    const { projectIds } = parse(z.object({ projectIds: z.array(z.string().regex(/^[\w-]{2,64}$/)).min(1).max(200) }), req.body);
    void runBuild(server, projectIds).catch(() => undefined);
    auditServer(req, server.id, "modlist.build", { count: projectIds.length });
    return { ok: true };
  });

  app.get<IdParams>("/api/servers/:id/modlist/job", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "plugins");
    return { job: getBuildJob(server.id), zip: await clientZipInfo(server.id), preset: getPreset(server.id) };
  });

  app.post<IdParams>("/api/servers/:id/modlist/preset", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "plugins");
    const { autoUpdate } = parse(z.object({ autoUpdate: z.boolean() }), req.body);
    setPresetAutoUpdate(server.id, autoUpdate);
    return { ok: true };
  });

  app.post<IdParams>("/api/servers/:id/modlist/rebuild", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "plugins");
    const preset = getPreset(server.id);
    if (!preset?.mods.length) throw notFound("Пресет");
    void runBuild(server, preset.mods.map((m) => m.id)).catch(() => undefined);
    auditServer(req, server.id, "modlist.rebuild", { count: preset.mods.length });
    return { ok: true };
  });

  app.get<IdParams>("/api/servers/:id/modlist/client.zip", { preHandler: requireUser }, async (req, reply) => {
    const { server } = serverFor(req, "monitor");
    const info = await clientZipInfo(server.id);
    if (!info) throw notFound("Архив");
    const name = getBuildJob(server.id)?.zipName ?? `${server.id}-mods-${server.mc_version}.zip`;
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Length", info.size);
    reply.header("Content-Disposition", attachment(name));
    return reply.send(createReadStream(clientZipPath(server.id)));
  });
}
