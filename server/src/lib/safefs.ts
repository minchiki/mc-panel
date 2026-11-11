import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readlink, realpath, rename, rm, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpError } from "./errors.js";
import { isWithin } from "./paths.js";

/*
 * File writes into server folders. Those folders are writable by the game container,
 * so any plugin or mod can plant symlinks there (`config -> /var/lib/mc-panel`).
 * A lexical path check is not enough: everything here resolves real paths, never
 * follows a symlink at the final component, and re-checks the opened file through
 * /proc/self/fd so a directory swapped for a symlink mid-operation is caught.
 */

const escape = () => new HttpError(400, "Путь выходит за пределы папки сервера");

/** Throws when an open file is not inside `realRoot` (Linux only; a no-op elsewhere, e.g. in local tests on Windows). */
export async function assertHandleInside(fh: FileHandle, realRoot: string): Promise<void> {
  if (process.platform !== "linux") return;
  const real = await readlink(`/proc/self/fd/${fh.fd}`);
  if (!isWithin(realRoot, real)) throw escape();
}

/**
 * Creates `dir` inside `root` one level at a time and returns its real path.
 * Every level, after resolving symlinks, must stay inside root.
 */
export async function mkdirInside(root: string, dir: string): Promise<string> {
  const realRoot = await realpath(root);
  const rel = relative(resolve(root), resolve(dir));
  if (rel.startsWith("..") || isAbsolute(rel)) throw escape();
  let cur = realRoot;
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    const next = join(cur, part);
    await mkdir(next).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "EEXIST") throw err;
    });
    const real = await realpath(next);
    if (!isWithin(realRoot, real)) throw escape();
    if (!(await lstat(real)).isDirectory()) throw new HttpError(400, `«${part}» не папка`);
    cur = real;
  }
  return cur;
}

export interface WriteOptions {
  /** Abort (and leave nothing behind) once more than this many bytes arrive. */
  maxBytes?: number;
  /** Error thrown when maxBytes is exceeded. */
  tooBig?: () => Error;
  mode?: number;
}

const defaultTooBig = () => new HttpError(507, "Недостаточно места: лимит диска сервера");

/**
 * Writes `dest` (inside `root`) atomically through a temp file next to it.
 * A symlink already at `dest` is replaced, never followed. Returns bytes written.
 */
export async function writeInside(root: string, dest: string, data: Readable | Buffer | string, opts: WriteOptions = {}): Promise<number> {
  const realRoot = await realpath(root);
  const dir = await mkdirInside(root, dirname(dest));
  const name = basename(dest);
  const tmp = join(dir, `.${name.slice(0, 100)}.${randomBytes(6).toString("hex")}.part`);
  const fh = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, opts.mode ?? 0o644);
  let bytes = 0;
  try {
    await assertHandleInside(fh, realRoot);
    if (typeof data === "string" || Buffer.isBuffer(data)) {
      const buf = typeof data === "string" ? Buffer.from(data) : data;
      if (opts.maxBytes !== undefined && buf.length > opts.maxBytes) throw (opts.tooBig ?? defaultTooBig)();
      await fh.writeFile(buf);
      bytes = buf.length;
    } else {
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          bytes += chunk.length;
          if (opts.maxBytes !== undefined && bytes > opts.maxBytes) cb((opts.tooBig ?? defaultTooBig)());
          else cb(null, chunk);
        },
      });
      // The stream owns the handle from here and closes it when done (pipeline waits for that).
      await pipeline(data, meter, fh.createWriteStream());
    }
    await fh.close();
  } catch (err) {
    await fh.close().catch(() => undefined);
    await rm(tmp, { force: true });
    throw err;
  }
  try {
    await rename(tmp, join(dir, name));
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return bytes;
}

/** Opens an existing regular file for reading, refusing symlinks and anything outside `root`. */
export async function openReadInside(root: string, path: string): Promise<FileHandle> {
  const realRoot = await realpath(root);
  const fh = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await assertHandleInside(fh, realRoot);
    if (!(await fh.stat()).isFile()) throw new HttpError(400, "Это не файл");
  } catch (err) {
    await fh.close();
    throw err;
  }
  return fh;
}

/** Reads a small regular file inside `root` (no symlinks, no devices like /dev/zero, size-capped). */
export async function readInside(root: string, path: string, maxBytes = 5 * 1024 * 1024): Promise<Buffer> {
  const fh = await openReadInside(root, path);
  try {
    if ((await fh.stat()).size > maxBytes) throw new HttpError(400, "Файл слишком большой");
    return await fh.readFile();
  } finally {
    await fh.close();
  }
}
