import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { statfs } from "node:fs/promises";
import { dataDirOf } from "./repo.js";

const execFileAsync = promisify(execFile);
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; bytes: number }>();

export async function dirSizeBytes(dir: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("du", ["-sb", dir], { timeout: 120_000 });
    return Number(stdout.split(/\s/)[0]) || 0;
  } catch {
    return 0;
  }
}

/** Cached usage of a server's data dir; pass `fresh` after uploads/extracts. */
export async function serverDiskBytes(serverId: string, fresh = false): Promise<number> {
  const hit = cache.get(serverId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.bytes;
  const bytes = await dirSizeBytes(dataDirOf(serverId));
  cache.set(serverId, { at: Date.now(), bytes });
  return bytes;
}

export function invalidateDisk(serverId: string): void {
  cache.delete(serverId);
}

export async function hostDisk(path: string): Promise<{ totalBytes: number; freeBytes: number }> {
  const s = await statfs(path);
  return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
}
