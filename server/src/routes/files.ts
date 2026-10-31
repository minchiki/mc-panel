import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/guard.js";
import { badRequest } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { resetAddons, resetWorld } from "../servers/reset.js";
import { deletePaths, listDir, makeDir, openDownload, readText, renamePath, saveUpload, unzip, writeText, zipPaths } from "../files/service.js";
import { auditServer, serverFor, type IdParams } from "./common.js";

const pathSchema = z.string().max(1024);
type PathQuery = IdParams & { Querystring: { path?: string } };

/** Header-safe Content-Disposition with RFC 5987 UTF-8 filename. */
export function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.get<PathQuery>("/api/servers/:id/files", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "files");
    return { entries: await listDir(server.id, req.query.path ?? "") };
  });

  app.get<PathQuery>("/api/servers/:id/files/content", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "files");
    return readText(server.id, req.query.path ?? "");
  });

  app.put<IdParams>("/api/servers/:id/files/content", { preHandler: requireUser, bodyLimit: 6 * 1024 * 1024 }, async (req) => {
    const { server } = serverFor(req, "files");
    const body = parse(z.object({ path: pathSchema.min(1), content: z.string() }), req.body);
    await writeText(server.id, body.path, body.content);
    auditServer(req, server.id, "files.write", { path: body.path });
    return { ok: true };
  });

  app.get<PathQuery>("/api/servers/:id/files/download", { preHandler: requireUser }, async (req, reply) => {
    const { server } = serverFor(req, "files");
    const file = await openDownload(server.id, req.query.path ?? "");
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Length", file.size);
    reply.header("Content-Disposition", attachment(file.name));
    return reply.send(file.stream);
  });

  app.post<IdParams>("/api/servers/:id/files/mkdir", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "files");
    const { path } = parse(z.object({ path: pathSchema.min(1) }), req.body);
    await makeDir(server.id, path);
    auditServer(req, server.id, "files.mkdir", { path });
    return { ok: true };
  });

  app.post<IdParams>("/api/servers/:id/files/rename", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "files");
    const body = parse(z.object({ from: pathSchema.min(1), to: pathSchema.min(1) }), req.body);
    await renamePath(server.id, body.from, body.to);
    auditServer(req, server.id, "files.rename", body);
    return { ok: true };
  });

  app.post<IdParams>("/api/servers/:id/files/delete", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "files");
    const { paths } = parse(z.object({ paths: z.array(pathSchema.min(1)).min(1).max(500) }), req.body);
    await deletePaths(server.id, paths);
    auditServer(req, server.id, "files.delete", { paths });
    return { ok: true };
  });

  app.post<IdParams>("/api/servers/:id/files/zip", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "files");
    const body = parse(z.object({ paths: z.array(pathSchema.min(1)).min(1).max(500), name: z.string().min(1).max(200) }), req.body);
    const path = await zipPaths(server.id, body.paths, body.name);
    auditServer(req, server.id, "files.zip", { path });
    return { path };
  });

  app.post<IdParams>("/api/servers/:id/files/unzip", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "files");
    const body = parse(z.object({ path: pathSchema.min(1), dest: pathSchema.optional() }), req.body);
    if (!body.path.toLowerCase().endsWith(".zip")) throw badRequest("Поддерживаются только .zip архивы");
    const count = await unzip(server.id, body.path, body.dest);
    auditServer(req, server.id, "files.unzip", { path: body.path, count });
    return { count };
  });

  // Multipart upload; `path` (target dir) comes as a query param so we can
  // validate it before reading the file stream.
  app.post<PathQuery>("/api/servers/:id/files/upload", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "files");
    const dir = req.query.path ?? "";
    const names: string[] = [];
    for await (const part of req.files()) {
      const name = part.filename.split(/[\\/]/).pop() ?? "";
      await saveUpload(server.id, dir, name, part.file);
      if (part.file.truncated) throw badRequest(`Файл ${name} слишком большой`);
      names.push(name);
    }
    auditServer(req, server.id, "files.upload", { dir, names });
    return { uploaded: names };
  });

  // ---------------------------------------------------------- danger zone
  app.post<IdParams>("/api/servers/:id/files/reset-world", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "files");
    const { backupFirst } = parse(z.object({ backupFirst: z.boolean().default(true) }), req.body ?? {});
    const removed = await resetWorld(server, backupFirst);
    auditServer(req, server.id, "files.reset_world", { removed, backupFirst });
    return { removed };
  });

  app.post<IdParams>("/api/servers/:id/files/reset-addons", { preHandler: requireUser }, async (req) => {
    const { server } = serverFor(req, "files");
    serverFor(req, "plugins");
    const removed = await resetAddons(server);
    auditServer(req, server.id, "files.reset_addons", { removed });
    return { removed };
  });
}
