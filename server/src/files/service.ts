import { TarArchive, ZipArchive } from "archiver";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import yauzl from "yauzl";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors.js";
import { assertFileName, isWithin, resolveExisting, resolveInside, toRelative, writeNoFollow } from "../lib/paths.js";
import { invalidateDisk, serverDiskBytes } from "../servers/disk.js";
import { dataDirOf, getServer } from "../servers/repo.js";

export const MAX_EDIT_BYTES = 5 * 1024 * 1024;

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "link";
  size: number;
  modifiedAt: number;
}

const root = (serverId: string) => dataDirOf(serverId);

/** Resolve a not-yet-existing target: its parent must exist and be inside root (after symlinks). */
async function resolveNew(serverId: string, userPath: string): Promise<string> {
  const target = resolveInside(root(serverId), userPath);
  const parent = dirname(target);
  const [realRoot, realParent] = await Promise.all([realpath(root(serverId)), realpath(parent).catch(() => null)]);
  if (!realParent) throw notFound("Папка", "f");
  if (!isWithin(realRoot, realParent)) throw badRequest("Путь выходит за пределы папки сервера");
  return target;
}

/**
 * Resolve an existing entry without following its final component (so a symlink
 * itself can be deleted/renamed), but with every parent directory resolved and checked.
 */
async function resolveEntry(serverId: string, userPath: string): Promise<string> {
  const target = resolveInside(root(serverId), userPath);
  if (target === root(serverId)) throw badRequest("Нельзя выполнить это с корнем сервера");
  const [realRoot, realParent] = await Promise.all([realpath(root(serverId)), realpath(dirname(target)).catch(() => null)]);
  if (!realParent || !(await exists(target))) throw notFound("Файл");
  if (!isWithin(realRoot, realParent)) throw badRequest("Путь выходит за пределы папки сервера");
  return join(realParent, target.slice(dirname(target).length + 1));
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

export async function listDir(serverId: string, userPath: string): Promise<FileEntry[]> {
  const dir = await resolveExisting(root(serverId), userPath);
  const st = await stat(dir);
  if (!st.isDirectory()) throw badRequest("Это не папка");
  const names = await readdir(dir);
  const entries = await Promise.all(
    names.map(async (name): Promise<FileEntry | null> => {
      const full = join(dir, name);
      const l = await lstat(full).catch(() => null);
      if (!l) return null;
      const type = l.isSymbolicLink() ? "link" : l.isDirectory() ? "dir" : "file";
      return { name, path: toRelative(root(serverId), full), type, size: l.size, modifiedAt: l.mtimeMs };
    }),
  );
  return entries
    .filter((e): e is FileEntry => e !== null)
    .sort((a, b) => (a.type === "dir" ? 0 : 1) - (b.type === "dir" ? 0 : 1) || a.name.localeCompare(b.name));
}

export async function readText(serverId: string, userPath: string): Promise<{ content: string; size: number }> {
  const file = await resolveExisting(root(serverId), userPath);
  const st = await stat(file);
  if (!st.isFile()) throw badRequest("Это не файл");
  if (st.size > MAX_EDIT_BYTES) throw badRequest("Файл слишком большой для редактора (больше 5 МБ). Скачайте его.");
  const buf = await readFile(file);
  if (buf.subarray(0, 8000).includes(0)) throw badRequest("Это бинарный файл, его нельзя открыть в редакторе");
  return { content: buf.toString("utf8"), size: st.size };
}

export async function writeText(serverId: string, userPath: string, content: string): Promise<void> {
  if (Buffer.byteLength(content) > MAX_EDIT_BYTES) throw badRequest("Слишком большой файл");
  const target = (await exists(resolveInside(root(serverId), userPath)))
    ? await resolveExisting(root(serverId), userPath)
    : await resolveNew(serverId, userPath);
  await assertQuota(serverId, Buffer.byteLength(content));
  await writeNoFollow(target, content);
  invalidateDisk(serverId);
}

export async function makeDir(serverId: string, userPath: string): Promise<void> {
  const target = await resolveNew(serverId, userPath);
  if (await exists(target)) throw conflict("Уже существует");
  await mkdir(target);
}

export async function renamePath(serverId: string, from: string, to: string): Promise<void> {
  const src = await resolveEntry(serverId, from);
  const dest = await resolveNew(serverId, to);
  if (await exists(dest)) throw conflict("Файл с таким именем уже есть");
  await rename(src, dest);
}

export async function deletePaths(serverId: string, paths: string[]): Promise<void> {
  for (const p of paths) {
    // Already gone (e.g. deleted from another tab) is fine for a bulk delete.
    const target = await resolveEntry(serverId, p).catch((err: unknown) => {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    });
    if (target) await rm(target, { recursive: true, force: true });
  }
  invalidateDisk(serverId);
}

export async function openDownload(serverId: string, userPath: string): Promise<{ stream: Readable; size: number; name: string }> {
  const file = await resolveExisting(root(serverId), userPath);
  const st = await stat(file);
  if (!st.isFile()) throw badRequest("Скачать можно только файл (папку сначала заархивируйте)");
  return { stream: createReadStream(file), size: st.size, name: file.split(/[\\/]/).pop() ?? "file" };
}

export async function saveUpload(serverId: string, dirPath: string, fileName: string, data: Readable): Promise<void> {
  assertFileName(fileName);
  const dir = await resolveExisting(root(serverId), dirPath);
  if (!(await stat(dir)).isDirectory()) throw badRequest("Это не папка");
  const target = join(dir, fileName);
  if ((await lstat(target).catch(() => null))?.isSymbolicLink()) throw badRequest("Нельзя перезаписать ссылку");
  await assertQuota(serverId, 0);
  const part = `${target}.uploading`;
  try {
    await rm(part, { force: true });
    await pipeline(data, createWriteStream(part, { flags: "wx" }));
    await rename(part, target);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
  invalidateDisk(serverId);
  await assertQuota(serverId, 0).catch(async (err) => {
    await rm(target, { force: true });
    invalidateDisk(serverId);
    throw err;
  });
}

async function assertQuota(serverId: string, extraBytes: number): Promise<void> {
  const server = getServer(serverId);
  const used = await serverDiskBytes(serverId, true);
  if (used + extraBytes > server.disk_mb * 1024 * 1024) {
    throw new HttpError(507, `Недостаточно места: лимит сервера ${server.disk_mb} МБ`);
  }
}

/** Walks a tree without following symlinks. */
async function* walk(dir: string): AsyncGenerator<string> {
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const l = await lstat(full);
    if (l.isSymbolicLink()) continue;
    if (l.isDirectory()) yield* walk(full);
    else if (l.isFile()) yield full;
  }
}

export async function zipPaths(serverId: string, paths: string[], destName: string): Promise<string> {
  assertFileName(destName);
  const base = root(serverId);
  const first = paths[0];
  if (!first) throw badRequest("Не выбраны файлы");
  const destDir = dirname(resolveInside(base, first));
  const dest = join(destDir, destName.endsWith(".zip") ? destName : `${destName}.zip`);
  if (await exists(dest)) throw conflict("Архив с таким именем уже есть");
  await assertQuota(serverId, 0);
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const out = createWriteStream(dest, { flags: "wx" });
  const done = pipeline(archive, out);
  for (const p of paths) {
    const target = await resolveExisting(base, p);
    const l = await lstat(target);
    if (l.isDirectory()) {
      for await (const file of walk(target)) archive.file(file, { name: relative(destDir, file).split("\\").join("/") });
    } else if (l.isFile()) {
      archive.file(target, { name: relative(destDir, target).split("\\").join("/") });
    }
  }
  await archive.finalize();
  await done;
  invalidateDisk(serverId);
  return toRelative(base, dest);
}

/** Extracts a zip next to itself (or into `destDir`), refusing entries that escape it and enforcing the quota. */
export async function unzip(serverId: string, zipPath: string, destDir?: string): Promise<number> {
  const base = root(serverId);
  const zipFile = await resolveExisting(base, zipPath);
  const target = destDir !== undefined ? await resolveExisting(base, destDir) : dirname(zipFile);
  const server = getServer(serverId);
  const budget = server.disk_mb * 1024 * 1024 - (await serverDiskBytes(serverId, true));
  let written = 0;
  let count = 0;

  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(zipFile, { lazyEntries: true, strictFileNames: true }, (err, z) => (err || !z ? reject(err ?? new Error("zip")) : resolve(z))),
  );
  await new Promise<void>((resolve, reject) => {
    // yauzl rejects absolute/".." entry names itself; surface that as a user error, not a 500.
    zip.on("error", (err: Error) => reject(badRequest(`Архив повреждён или содержит небезопасные пути (${err.message})`)));
    zip.on("end", resolve);
    zip.on("entry", (entry: yauzl.Entry) => {
      void (async () => {
        const out = resolveInside(target, entry.fileName);
        if (!isWithin(base, out)) throw badRequest(`Небезопасный путь в архиве: ${entry.fileName}`);
        if (entry.fileName.endsWith("/")) {
          await mkdir(out, { recursive: true });
          return;
        }
        written += entry.uncompressedSize;
        if (written > budget) throw new HttpError(507, "Распакованный архив не помещается в лимит диска сервера");
        await mkdir(dirname(out), { recursive: true });
        const realParent = await realpath(dirname(out));
        if (!isWithin(await realpath(base), realParent)) throw badRequest("Путь выходит за пределы папки сервера");
        if ((await lstat(out).catch(() => null))?.isSymbolicLink()) throw badRequest("Архив перезаписывает ссылку");
        const stream = await new Promise<Readable>((res, rej) => zip.openReadStream(entry, (e, s) => (e || !s ? rej(e) : res(s))));
        await pipeline(stream, createWriteStream(out));
        count++;
      })()
        .then(() => zip.readEntry())
        .catch((err) => {
          zip.close();
          reject(err);
        });
    });
    zip.readEntry();
  });
  invalidateDisk(serverId);
  return count;
}
