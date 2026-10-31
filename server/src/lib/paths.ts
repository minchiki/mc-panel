import { constants } from "node:fs";
import { open, realpath, rm } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { HttpError } from "./errors.js";

/**
 * Resolve a user-supplied relative path inside `root`. Rejects absolute paths,
 * `..` escapes and NUL bytes. Lexical check only; see `resolveExisting` for symlinks.
 */
export function resolveInside(root: string, userPath: string): string {
  if (userPath.includes("\0")) throw new HttpError(400, "Недопустимый путь");
  const cleaned = userPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const target = resolve(root, normalize(cleaned || "."));
  if (!isWithin(root, target)) throw new HttpError(400, "Путь выходит за пределы папки сервера");
  return target;
}

export function isWithin(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.startsWith(`..${sep}`));
}

/** Like resolveInside, but also follows symlinks of an existing path and re-checks. */
export async function resolveExisting(root: string, userPath: string): Promise<string> {
  const target = resolveInside(root, userPath);
  const [realRoot, realTarget] = await Promise.all([
    realpath(root),
    realpath(target).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT" || err.code === "ENOTDIR") throw new HttpError(404, "Файл или папка не найдены");
      throw err;
    }),
  ]);
  if (!isWithin(realRoot, realTarget)) throw new HttpError(400, "Путь выходит за пределы папки сервера");
  return realTarget;
}

/**
 * Write a file inside a container-writable directory without ever following a
 * symlink at the final component: game code could plant `server.properties ->
 * /etc/mc-panel/.env`. A planted link is removed and replaced by a regular file.
 */
export async function writeNoFollow(path: string, content: string | Buffer): Promise<void> {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;
  let handle;
  try {
    handle = await open(path, flags, 0o644);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ELOOP") throw err;
    await rm(path, { force: true });
    handle = await open(path, flags, 0o644);
  }
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}

/** Path relative to root with forward slashes, for API responses. */
export function toRelative(root: string, target: string): string {
  return relative(root, target).split(sep).join("/");
}

const BAD_NAME = /[\0/\\]/;

export function assertFileName(name: string): void {
  if (!name || name === "." || name === ".." || BAD_NAME.test(name) || name.length > 255) {
    throw new HttpError(400, "Недопустимое имя файла");
  }
}
