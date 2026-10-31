import { spawn } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { all, one, run } from "../db/index.js";
import { randomId } from "../lib/crypto.js";
import { conflict, errorMessage, notFound } from "../lib/errors.js";
import { invalidateDisk } from "../servers/disk.js";
import { backupDirOf, dataDirOf, getServer } from "../servers/repo.js";
import { runtime, sendCommand, withServerStopped } from "../servers/runtime.js";

export interface BackupRow {
  id: string;
  server_id: string;
  name: string;
  file: string;
  size_bytes: number;
  status: "running" | "done" | "failed";
  error: string | null;
  created_at: number;
}

export interface BackupSettings {
  max_count: number;
  excludes: string;
}

const running = new Set<string>();

export function listBackups(serverId: string): BackupRow[] {
  return all<BackupRow>("SELECT * FROM backups WHERE server_id = ? ORDER BY created_at DESC", serverId);
}

export function getBackup(serverId: string, backupId: string): BackupRow {
  const row = one<BackupRow>("SELECT * FROM backups WHERE id = ? AND server_id = ?", backupId, serverId);
  if (!row) throw notFound("Бэкап");
  return row;
}

export function getBackupSettings(serverId: string): BackupSettings {
  return one<BackupSettings>("SELECT max_count, excludes FROM backup_settings WHERE server_id = ?", serverId) ?? {
    max_count: 5,
    excludes: "logs\ncache\ncrash-reports",
  };
}

export function setBackupSettings(serverId: string, s: BackupSettings): void {
  run(
    `INSERT INTO backup_settings (server_id, max_count, excludes) VALUES (?, ?, ?)
     ON CONFLICT(server_id) DO UPDATE SET max_count = excluded.max_count, excludes = excluded.excludes`,
    serverId,
    s.max_count,
    s.excludes,
  );
}

/** Exclude patterns are relative to the server root; anything absolute or with ".." is dropped. */
export function sanitizeExcludes(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^\.?\/+/, ""))
    .filter((l) => l && !l.startsWith("/") && !l.split("/").includes(".."))
    .slice(0, 50);
}

function tar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    // Exit code 1 = "some files changed while reading": acceptable for a live server.
    child.on("close", (code) => (code === 0 || code === 1 ? resolve() : reject(new Error(stderr.trim().slice(-500) || `tar exit ${code}`))));
  });
}

/**
 * Creates a .tar.gz of the server directory. When the server is online the
 * world is flushed and autosave paused for the duration.
 */
export async function createBackup(serverId: string, name: string): Promise<BackupRow> {
  if (running.has(serverId)) throw conflict("Бэкап уже создаётся");
  running.add(serverId);
  const server = getServer(serverId);
  const id = randomId(10);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = `${stamp}-${id}.tar.gz`;
  const dir = backupDirOf(serverId);
  run(
    "INSERT INTO backups (id, server_id, name, file, status, created_at) VALUES (?, ?, ?, ?, 'running', ?)",
    id,
    serverId,
    name,
    file,
    Date.now(),
  );
  const rt = runtime(serverId);
  const live = rt.status === "online" && server.core !== "velocity" && server.core !== "bungeecord";
  try {
    await mkdir(dir, { recursive: true });
    if (live) {
      sendCommand(serverId, "save-off");
      sendCommand(serverId, "save-all flush");
      await new Promise((r) => setTimeout(r, 5000));
    }
    const excludes = sanitizeExcludes(getBackupSettings(serverId).excludes).map((e) => `--exclude=./${e}`);
    const part = join(dir, `${file}.part`);
    await tar(["-czf", part, ...excludes, "-C", dataDirOf(serverId), "."]);
    await rename(part, join(dir, file));
    const size = (await stat(join(dir, file))).size;
    run("UPDATE backups SET status = 'done', size_bytes = ? WHERE id = ?", size, id);
    rt.panel(`Бэкап «${name}» создан (${(size / 1024 / 1024).toFixed(1)} МБ)`);
    await pruneBackups(serverId);
  } catch (err) {
    run("UPDATE backups SET status = 'failed', error = ? WHERE id = ?", errorMessage(err), id);
    await rm(join(dir, `${file}.part`), { force: true });
    rt.panel(`Бэкап не удался: ${errorMessage(err)}`);
    throw err;
  } finally {
    if (live && rt.status === "online") {
      try {
        sendCommand(serverId, "save-on");
      } catch {
        // server went down meanwhile
      }
    }
    running.delete(serverId);
  }
  return getBackup(serverId, id);
}

async function pruneBackups(serverId: string): Promise<void> {
  const { max_count } = getBackupSettings(serverId);
  const done = listBackups(serverId).filter((b) => b.status === "done");
  for (const old of done.slice(Math.max(max_count, 1))) await deleteBackup(serverId, old.id);
}

export async function deleteBackup(serverId: string, backupId: string): Promise<void> {
  const b = getBackup(serverId, backupId);
  await rm(join(backupDirOf(serverId), basename(b.file)), { force: true });
  run("DELETE FROM backups WHERE id = ?", backupId);
}

export function backupPath(b: BackupRow): string {
  return join(backupDirOf(b.server_id), basename(b.file));
}

/**
 * Restores into a fresh directory, then swaps it in. The previous contents are
 * only removed after the new tree is complete, so a failed restore keeps the server intact.
 */
export async function restoreBackup(serverId: string, backupId: string): Promise<void> {
  const b = getBackup(serverId, backupId);
  if (b.status !== "done") throw conflict("Этот бэкап не завершён");
  await withServerStopped(serverId, async (rt) => {
    const target = dataDirOf(serverId);
    const stamp = Date.now();
    const staging = `${target}.restore-${stamp}`;
    const old = `${target}.old-${stamp}`;
    rt.panel(`Восстанавливаю бэкап «${b.name}»...`);
    await mkdir(staging, { recursive: true });
    try {
      await tar(["-xzf", backupPath(b), "-C", staging, "--no-same-owner", "--no-same-permissions"]);
      await rename(target, old);
      await rename(staging, target);
      await rm(old, { recursive: true, force: true });
      rt.panel("Бэкап восстановлен");
    } catch (err) {
      await rm(staging, { recursive: true, force: true });
      rt.panel(`Восстановление не удалось: ${errorMessage(err)}`);
      throw err;
    } finally {
      invalidateDisk(serverId);
    }
  });
}
