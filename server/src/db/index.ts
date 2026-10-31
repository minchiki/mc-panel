import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { migrations } from "./migrations.js";

export type Row = Record<string, unknown>;

let db: DatabaseSync | null = null;

export function openDb(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const conn = new DatabaseSync(join(dataDir, "panel.db"));
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(conn);
  db = conn;
  return conn;
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error("Database is not open");
  return db;
}

function migrate(conn: DatabaseSync): void {
  conn.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = conn.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let current = row?.version ?? 0;
  if (!row) conn.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  for (const [i, sql] of migrations.entries()) {
    const version = i + 1;
    if (version <= current) continue;
    conn.exec("BEGIN");
    try {
      conn.exec(sql);
      conn.prepare("UPDATE schema_version SET version = ?").run(version);
      conn.exec("COMMIT");
      current = version;
    } catch (err) {
      conn.exec("ROLLBACK");
      throw err;
    }
  }
}

/** Typed helpers so call sites stay short. */
export function one<T>(sql: string, ...params: SqlParam[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: SqlParam[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: SqlParam[]): { changes: number; lastInsertRowid: number } {
  const res = getDb().prepare(sql).run(...params);
  return { changes: Number(res.changes), lastInsertRowid: Number(res.lastInsertRowid) };
}

export type SqlParam = string | number | bigint | null | Uint8Array;

export function tx<T>(fn: () => T): T {
  const conn = getDb();
  conn.exec("BEGIN");
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}
