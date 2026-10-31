import { hash, verify } from "@node-rs/argon2";
import { all, one, run } from "../db/index.js";
import { conflict, notFound } from "../lib/errors.js";

export type Role = "admin" | "user";

export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  role: Role;
  totp_secret: string | null;
  totp_enabled: number;
  max_servers: number;
  max_ram_mb: number;
  disabled: number;
  created_at: number;
}

export interface PublicUser {
  id: number;
  username: string;
  email: string | null;
  role: Role;
  totpEnabled: boolean;
  maxServers: number;
  maxRamMb: number;
  disabled: boolean;
  createdAt: number;
}

export function toPublic(u: UserRow): PublicUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    totpEnabled: u.totp_enabled === 1,
    maxServers: u.max_servers,
    maxRamMb: u.max_ram_mb,
    disabled: u.disabled === 1,
    createdAt: u.created_at,
  };
}

// OWASP-recommended argon2id baseline (19 MiB, t=2).
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

// Used to keep login timing similar for unknown usernames.
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("timing-equaliser");
  await verifyPassword(await dummyHash, password);
}

export function findByUsername(username: string): UserRow | undefined {
  return one<UserRow>("SELECT * FROM users WHERE username = ?", username);
}

export function findById(id: number): UserRow | undefined {
  return one<UserRow>("SELECT * FROM users WHERE id = ?", id);
}

export function getUser(id: number): UserRow {
  const u = findById(id);
  if (!u) throw notFound("Пользователь");
  return u;
}

export function listUsers(): UserRow[] {
  return all<UserRow>("SELECT * FROM users ORDER BY id");
}

export function countUsers(): number {
  return one<{ n: number }>("SELECT COUNT(*) AS n FROM users")?.n ?? 0;
}

export async function createUser(input: { username: string; email?: string | null; password: string; role: Role }): Promise<UserRow> {
  if (findByUsername(input.username)) throw conflict("Такое имя пользователя уже занято");
  if (input.email && one("SELECT 1 FROM users WHERE email = ?", input.email)) throw conflict("Такой email уже используется");
  const passwordHash = await hashPassword(input.password);
  const res = run(
    "INSERT INTO users (username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
    input.username,
    input.email || null,
    passwordHash,
    input.role,
    Date.now(),
  );
  return getUser(res.lastInsertRowid);
}

export async function setPassword(userId: number, password: string): Promise<void> {
  run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(password), userId);
}

export function updateUser(
  id: number,
  patch: Partial<{ role: Role; maxServers: number; maxRamMb: number; disabled: boolean; email: string | null }>,
): UserRow {
  const u = getUser(id);
  run(
    "UPDATE users SET role = ?, max_servers = ?, max_ram_mb = ?, disabled = ?, email = ? WHERE id = ?",
    patch.role ?? u.role,
    patch.maxServers ?? u.max_servers,
    patch.maxRamMb ?? u.max_ram_mb,
    patch.disabled === undefined ? u.disabled : patch.disabled ? 1 : 0,
    patch.email === undefined ? u.email : patch.email,
    id,
  );
  return getUser(id);
}

export function deleteUser(id: number): void {
  if (one("SELECT 1 FROM servers WHERE owner_id = ?", id)) throw conflict("Сначала удалите или передайте серверы пользователя");
  run("DELETE FROM users WHERE id = ?", id);
}
