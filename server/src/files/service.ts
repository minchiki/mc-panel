import { TarArchive, ZipArchive } from "archiver";
import { once } from "node:events";
import { lstat, readdir, realpath, rename, rm, stat, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { Readable } from "node:stream";
import yauzl from "yauzl";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors.js";
import { assertFileName, isWithin, resolveExisting, resolveInside, toRelative } from "../lib/paths.js";
import { mkdirInside, openReadInside, writeInside } from "../lib/safefs.js";
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
  return join(realParent, basename(target));
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
  if (!(await stat(file)).isFile()) throw badRequest("Это не файл");
  const fh = await openReadInside(root(serverId), file);
  let st, buf: Buffer;
  try {
    st = await fh.stat();
    if (st.size > MAX_EDIT_BYTES) throw badRequest("Файл слишком большой для редактора (больше 5 МБ). Скачайте его.");
    buf = await fh.readFile();
  } finally {
    await fh.close();
  }
  if (buf.subarray(0, 8000).includes(0)) throw badRequest("Это бинарный файл, его нельзя открыть в редакторе");
  return { content: buf.toString("utf8"), size: st.size };
}

export async function writeText(serverId: string, userPath: string, content: string): Promise<void> {
  if (Buffer.byteLength(content) > MAX_EDIT_BYTES) throw badRequest("Слишком большой файл");
  const target = (await exists(resolveInside(root(serverId), userPath)))
    ? await resolveExisting(root(serverId), userPath)
    : await resolveNew(serverId, userPath);
  await withQuota(serverId, async (budget) => {
    await writeInside(root(serverId), target, content, { maxBytes: budget, tooBig: quotaError(serverId) });
  });
}

export async function makeDir(serverId: string, userPath: string): Promise<void> {
  const target = await resolveNew(serverId, userPath);
  if (await exists(target)) throw conflict("Уже существует");
  await mkdirInside(root(serverId), target);
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
  if (!(await stat(file)).isFile()) throw badRequest("Скачать можно только файл (папку сначала заархивируйте)");
  const fh = await openReadInside(root(serverId), file);
  const { size } = await fh.stat();
  return { stream: fh.createReadStream(), size, name: file.split(/[\\/]/).pop() ?? "file" };
}

export async function saveUpload(serverId: string, dirPath: string, fileName: string, data: Readable): Promise<void> {
  assertFileName(fileName);
  const dir = await resolveExisting(root(serverId), dirPath);
  if (!(await stat(dir)).isDirectory()) throw badRequest("Это не папка");
  const target = join(dir, fileName);
  if ((await lstat(target).catch(() => null))?.isSymbolicLink()) throw badRequest("Нельзя перезаписать ссылку");
  await withQuota(serverId, async (budget) => {
    await writeInside(root(serverId), target, data, { maxBytes: budget, tooBig: quotaError(serverId) });
  });
}

const quotaError = (serverId: string) => () => new HttpError(507, `Недостаточно места: лимит сервера ${getServer(serverId).disk_mb} МБ`);

/**
 * Runs a write with the bytes still free on the server. Writes to one server are
 * queued, so parallel uploads cannot each spend the same remaining space.
 */
const quotaQueues = new Map<string, Promise<unknown>>();
async function withQuota<T>(serverId: string, fn: (budgetBytes: number) => Promise<T>): Promise<T> {
  const prev = quotaQueues.get(serverId) ?? Promise.resolve();
  const run = prev
    .catch(() => undefined)
    .then(async () => {
      const budget = getServer(serverId).disk_mb * 1024 * 1024 - (await serverDiskBytes(serverId, true));
      if (budget <= 0) throw quotaError(serverId)();
      try {
        return await fn(budget);
      } finally {
        invalidateDisk(serverId);
      }
    });
  quotaQueues.set(serverId, run);
  try {
    return await run;
  } finally {
    if (quotaQueues.get(serverId) === run) quotaQueues.delete(serverId);
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
  const destDir = await resolveExisting(base, toRelative(base, dirname(resolveInside(base, first))));
  const dest = join(destDir, destName.endsWith(".zip") ? destName : `${destName}.zip`);
  if (await exists(dest)) throw conflict("Архив с таким именем уже есть");
  await withQuota(serverId, async (budget) => {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const done = writeInside(base, dest, archive, { maxBytes: budget, tooBig: quotaError(serverId) });
    // Files are opened one at a time through a verified handle (no path re-resolution, no fd pile-up).
    const add = async (file: string) => {
      const fh = await openReadInside(base, file).catch(() => null);
      if (!fh) return;
      const entry = once(archive, "entry");
      archive.append(fh.createReadStream(), { name: relative(destDir, file).split("\\").join("/") });
      await entry;
    };
    try {
      for (const p of paths) {
        const target = await resolveExisting(base, p);
        const l = await lstat(target);
        if (l.isDirectory()) {
          for await (const file of walk(target)) await add(file);
        } else if (l.isFile()) {
          await add(target);
        }
      }
      await archive.finalize();
    } catch (err) {
      archive.abort();
      await done.catch(() => undefined);
      throw err;
    }
    await done;
  });
  return toRelative(base, dest);
}

/** Extracts a zip next to itself (or into `destDir`), refusing entries that escape it and enforcing the quota. */
export async function unzip(serverId: string, zipPath: string, destDir?: string): Promise<number> {
  const base = root(serverId);
  const zipFile = await resolveExisting(base, zipPath);
  const target = destDir !== undefined ? await resolveExisting(base, destDir) : dirname(zipFile);
  return withQuota(serverId, (budget) => unzipInto(base, zipFile, target, budget));
}

async function unzipInto(base: string, zipFile: string, target: string, budget: number): Promise<number> {
  // Read through a verified handle, so a swapped path cannot feed another server's archive in.
  const fh = await openReadInside(base, zipFile);
  try {
    return await extract(fh, base, target, budget);
  } finally {
    await fh.close();
  }
}

async function extract(fh: FileHandle, base: string, target: string, budget: number): Promise<number> {
  let written = 0;
  let count = 0;

  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromFd(fh.fd, { lazyEntries: true, strictFileNames: true, autoClose: false }, (err, z) => (err || !z ? reject(err ?? new Error("zip")) : resolve(z))),
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
          await mkdirInside(base, out);
          return;
        }
        const tooBig = () => new HttpError(507, "Распакованный архив не помещается в лимит диска сервера");
        if (written + entry.uncompressedSize > budget) throw tooBig();
        const stream = await new Promise<Readable>((res, rej) => zip.openReadStream(entry, (e, s) => (e || !s ? rej(e) : res(s))));
        written += await writeInside(base, out, stream, { maxBytes: budget - written, tooBig });
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
  return count;
}
