import type { FastifyInstance } from "fastify";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { requireUser } from "../auth/guard.js";
import { badRequest } from "../lib/errors.js";
import { resolveExisting, writeNoFollow } from "../lib/paths.js";
import { pngSize } from "../lib/png.js";
import { parse } from "../lib/validate.js";
import { dataDirOf } from "../servers/repo.js";
import { runtime } from "../servers/runtime.js";
import { auditServer, serverFor, type IdParams } from "./common.js";
import { readInside } from "../lib/safefs.js";

export const ICON_FILE = "server-icon.png";
/** Minecraft only accepts a 64×64 PNG; the browser converts anything else before upload. */
const ICON_SIZE = 64;
const MAX_ICON_BYTES = 256 * 1024;

export async function iconRoutes(app: FastifyInstance): Promise<void> {
  app.get<IdParams>("/api/servers/:id/icon", { preHandler: requireUser }, async (req, reply) => {
    const { server } = serverFor(req, "monitor");
    const path = await resolveExisting(dataDirOf(server.id), ICON_FILE);
    const data = await readInside(dataDirOf(server.id), path, MAX_ICON_BYTES);
    if (!pngSize(data)) throw badRequest("server-icon.png повреждён");
    reply.header("Content-Type", "image/png");
    reply.header("Cache-Control", "private, no-cache");
    return reply.send(data);
  });

  app.put<IdParams>("/api/servers/:id/icon", { preHandler: requireUser, bodyLimit: 512 * 1024 }, async (req) => {
    const { server } = serverFor(req, "settings");
    const { png } = parse(z.object({ png: z.string().max(400_000) }), req.body);
    const data = Buffer.from(png.replace(/^data:image\/png;base64,/, ""), "base64");
    if (data.length > MAX_ICON_BYTES) throw badRequest("Иконка слишком большая");
    const size = pngSize(data);
    if (!size) throw badRequest("Это не PNG");
    if (size.width !== ICON_SIZE || size.height !== ICON_SIZE) {
      throw badRequest(`Иконка должна быть ${ICON_SIZE}×${ICON_SIZE}, а не ${size.width}×${size.height}`);
    }
    await writeNoFollow(join(dataDirOf(server.id), ICON_FILE), data);
    auditServer(req, server.id, "server.icon", { bytes: data.length });
    return { ok: true, restartNeeded: runtime(server.id).status !== "offline" };
  });

  app.delete<IdParams>("/api/servers/:id/icon", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "settings");
    const path = await resolveExisting(dataDirOf(server.id), ICON_FILE).catch(() => null);
    if (path) await rm(path, { force: true });
    auditServer(req, server.id, "server.icon_delete");
    return { ok: true, restartNeeded: runtime(server.id).status !== "offline" };
  });
}
