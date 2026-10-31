import mysql from "mysql2/promise";
import { config } from "../config.js";
import { all, one, run } from "../db/index.js";
import { DB_NETWORK, docker, ensureImage, ensureNetwork, inspectContainer } from "../docker/client.js";
import { decrypt, encrypt, randomId, randomPassword } from "../lib/crypto.js";
import { conflict, notFound } from "../lib/errors.js";

export const MARIADB_CONTAINER = "mcp-mariadb";
const MARIADB_IMAGE = "mariadb:11.4";
const HOST_PORT = 3306;
const MAX_DBS_PER_SERVER = 5;

export interface DatabaseRow {
  id: number;
  server_id: string;
  name: string;
  username: string;
  password_enc: string;
  created_at: number;
}

/**
 * One shared MariaDB container, started lazily on first use. It is published
 * only on 127.0.0.1 (for the panel) and reachable by game containers through
 * the internal `mcp-db` network as host `mcp-mariadb`.
 */
export async function ensureMariaDb(): Promise<void> {
  const info = await inspectContainer(MARIADB_CONTAINER);
  if (info?.State.Running) return;
  if (info) {
    await docker.getContainer(MARIADB_CONTAINER).start();
  } else {
    await ensureImage(MARIADB_IMAGE);
    await ensureNetwork(DB_NETWORK);
    const c = await docker.createContainer({
      name: MARIADB_CONTAINER,
      Image: MARIADB_IMAGE,
      Env: [`MARIADB_ROOT_PASSWORD=${config.MARIADB_ROOT_PASSWORD}`, "MARIADB_AUTO_UPGRADE=1"],
      Cmd: ["--innodb-buffer-pool-size=128M", "--max-connections=200", "--performance-schema=OFF"],
      Labels: { "mc-panel": "mariadb" },
      ExposedPorts: { "3306/tcp": {} },
      HostConfig: {
        Binds: [`${config.MARIADB_DIR}:/var/lib/mysql`],
        PortBindings: { "3306/tcp": [{ HostIp: "127.0.0.1", HostPort: String(HOST_PORT) }] },
        Memory: 512 * 1024 * 1024,
        RestartPolicy: { Name: "unless-stopped" },
        NetworkMode: DB_NETWORK,
        SecurityOpt: ["no-new-privileges:true"],
      },
    });
    await c.start();
  }
  await waitForMariaDb();
}

async function rootConnection() {
  return mysql.createConnection({ host: "127.0.0.1", port: HOST_PORT, user: "root", password: config.MARIADB_ROOT_PASSWORD, connectTimeout: 5000 });
}

async function waitForMariaDb(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const conn = await rootConnection();
      await conn.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("MariaDB не запустилась за 60 секунд");
}

export function listDatabases(serverId: string): DatabaseRow[] {
  return all<DatabaseRow>("SELECT * FROM databases WHERE server_id = ? ORDER BY id", serverId);
}

export function connectionInfo(db: DatabaseRow) {
  return {
    id: db.id,
    name: db.name,
    username: db.username,
    password: decrypt(db.password_enc, config.SECRET_KEY),
    host: MARIADB_CONTAINER,
    port: 3306,
    jdbc: `jdbc:mariadb://${MARIADB_CONTAINER}:3306/${db.name}`,
  };
}

export async function createDatabase(serverId: string, label: string): Promise<DatabaseRow> {
  if (listDatabases(serverId).length >= MAX_DBS_PER_SERVER) throw conflict(`Не больше ${MAX_DBS_PER_SERVER} баз на сервер`);
  const suffix = label.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16) || "db";
  const name = `s${serverId}_${suffix}`;
  if (one("SELECT 1 FROM databases WHERE name = ?", name)) throw conflict("База с таким именем уже есть");
  const username = `u${serverId}_${randomId(5)}`;
  const password = randomPassword(24);
  await ensureMariaDb();
  const conn = await rootConnection();
  try {
    // Identifiers are generated from [a-z0-9_] only, so backtick quoting is safe.
    await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query("CREATE USER ?@'%' IDENTIFIED BY ?", [username, password]);
    await conn.query(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO ?@'%'`, [username]);
    await conn.query("FLUSH PRIVILEGES");
  } finally {
    await conn.end();
  }
  const res = run(
    "INSERT INTO databases (server_id, name, username, password_enc, created_at) VALUES (?, ?, ?, ?, ?)",
    serverId,
    name,
    username,
    encrypt(password, config.SECRET_KEY),
    Date.now(),
  );
  return one<DatabaseRow>("SELECT * FROM databases WHERE id = ?", res.lastInsertRowid)!;
}

export async function deleteDatabase(serverId: string, id: number): Promise<void> {
  const db = one<DatabaseRow>("SELECT * FROM databases WHERE id = ? AND server_id = ?", id, serverId);
  if (!db) throw notFound("База данных", "f");
  await ensureMariaDb();
  const conn = await rootConnection();
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${db.name}\``);
    await conn.query("DROP USER IF EXISTS ?@'%'", [db.username]);
  } finally {
    await conn.end();
  }
  run("DELETE FROM databases WHERE id = ?", id);
}

export async function rotatePassword(serverId: string, id: number): Promise<void> {
  const db = one<DatabaseRow>("SELECT * FROM databases WHERE id = ? AND server_id = ?", id, serverId);
  if (!db) throw notFound("База данных", "f");
  const password = randomPassword(24);
  await ensureMariaDb();
  const conn = await rootConnection();
  try {
    await conn.query("ALTER USER ?@'%' IDENTIFIED BY ?", [db.username, password]);
  } finally {
    await conn.end();
  }
  run("UPDATE databases SET password_enc = ? WHERE id = ?", encrypt(password, config.SECRET_KEY), id);
}

export async function dropServerDatabases(serverId: string): Promise<void> {
  for (const db of listDatabases(serverId)) await deleteDatabase(serverId, db.id);
}
