import { join } from "node:path";
import { config } from "../config.js";
import { all, one, run } from "../db/index.js";
import { conflict, notFound } from "../lib/errors.js";
import type { Core } from "../cores/types.js";

export interface ServerRow {
  id: string;
  owner_id: number;
  name: string;
  core: Core;
  mc_version: string;
  core_build: string | null;
  java_version: number;
  ram_mb: number;
  cpu_limit: number;
  disk_mb: number;
  port: number;
  startup: string;
  jvm_flags: string;
  domain: string | null;
  desired_state: "running" | "stopped";
  install_state: "pending" | "installing" | "installed" | "failed";
  auto_restart: number;
  rcon_password: string;
  created_at: number;
}

export const dataDirOf = (id: string) => join(config.SERVERS_DIR, id);
export const backupDirOf = (id: string) => join(config.BACKUPS_DIR, id);

export function getServer(id: string): ServerRow {
  const row = one<ServerRow>("SELECT * FROM servers WHERE id = ?", id);
  if (!row) throw notFound("Сервер");
  return row;
}

export function findServer(id: string): ServerRow | undefined {
  return one<ServerRow>("SELECT * FROM servers WHERE id = ?", id);
}

export function listAllServers(): ServerRow[] {
  return all<ServerRow>("SELECT * FROM servers ORDER BY created_at");
}

/** Servers the user owns or is a sub-user of (admins see everything). */
export function listServersFor(userId: number, isAdmin: boolean): ServerRow[] {
  if (isAdmin) return listAllServers();
  return all<ServerRow>(
    `SELECT s.* FROM servers s WHERE s.owner_id = ?
     UNION SELECT s.* FROM servers s JOIN subusers su ON su.server_id = s.id WHERE su.user_id = ?
     ORDER BY created_at`,
    userId,
    userId,
  );
}

export function insertServer(row: Omit<ServerRow, "created_at">): ServerRow {
  run(
    `INSERT INTO servers (id, owner_id, name, core, mc_version, core_build, java_version, ram_mb, cpu_limit, disk_mb, port,
       startup, jvm_flags, domain, desired_state, install_state, auto_restart, rcon_password, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.owner_id,
    row.name,
    row.core,
    row.mc_version,
    row.core_build,
    row.java_version,
    row.ram_mb,
    row.cpu_limit,
    row.disk_mb,
    row.port,
    row.startup,
    row.jvm_flags,
    row.domain,
    row.desired_state,
    row.install_state,
    row.auto_restart,
    row.rcon_password,
    Date.now(),
  );
  return getServer(row.id);
}

type Patchable = Omit<ServerRow, "id" | "created_at" | "owner_id" | "rcon_password"> & { owner_id: number };

export function updateServer(id: string, patch: Partial<Patchable>): ServerRow {
  const keys = Object.keys(patch) as (keyof Patchable)[];
  if (keys.length === 0) return getServer(id);
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] as string | number | null);
  run(`UPDATE servers SET ${sets} WHERE id = ?`, ...values, id);
  return getServer(id);
}

export function deleteServerRow(id: string): void {
  run("DELETE FROM servers WHERE id = ?", id);
}

export function usedPorts(): Set<number> {
  return new Set(all<{ port: number }>("SELECT port FROM servers").map((r) => r.port));
}

export function allocatePort(preferred?: number): number {
  const used = usedPorts();
  const { PORT_RANGE_START: start, PORT_RANGE_END: end } = config;
  if (preferred !== undefined) {
    if (preferred < start || preferred > end) throw conflict(`Порт должен быть в диапазоне ${start}–${end}`);
    if (used.has(preferred)) throw conflict(`Порт ${preferred} уже занят другим сервером`);
    return preferred;
  }
  for (let p = start; p <= end; p++) if (!used.has(p)) return p;
  throw conflict("Свободные порты закончились");
}

export function ownerUsage(ownerId: number): { servers: number; ramMb: number } {
  const row = one<{ n: number; ram: number | null }>("SELECT COUNT(*) AS n, SUM(ram_mb) AS ram FROM servers WHERE owner_id = ?", ownerId);
  return { servers: row?.n ?? 0, ramMb: row?.ram ?? 0 };
}
