import { hash, verify } from "@node-rs/argon2";
import { all, one, run } from "../db/index.js";
import { conflict, notFound } from "../lib/errors.js";

export type Role = "admin" | "user";

export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  email_verified: number;
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
  emailVerified: boolean;
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
    emailVerified: Boolean(u.email && u.email_verified === 1),
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

/** Only a confirmed address can receive password reset links. */
export function findByVerifiedEmail(email: string): UserRow | undefined {
  return one<UserRow>("SELECT * FROM users WHERE email = ? AND email_verified = 1", email);
}

export function emailTaken(email: string, exceptUserId: number): boolean {
  return Boolean(one("SELECT 1 FROM users WHERE email = ? AND id != ?", email, exceptUserId));
}

export function setVerifiedEmail(userId: number, email: string | null): void {
  run("UPDATE users SET email = ?, email_verified = ? WHERE id = ?", email, email ? 1 : 0, userId);
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

/** `emailVerified`: true when an admin typed the address; self-registration has to confirm it by email. */
export async function createUser(input: { username: string; email?: string | null; password: string; role: Role; emailVerified?: boolean }): Promise<UserRow> {
  if (findByUsername(input.username)) throw conflict("Такое имя пользователя уже занято");
  if (input.email && one("SELECT 1 FROM users WHERE email = ?", input.email)) throw conflict("Такой email уже используется");
  const passwordHash = await hashPassword(input.password);
  const res = run(
    "INSERT INTO users (username, email, email_verified, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    input.username,
    input.email || null,
    input.email && input.emailVerified ? 1 : 0,
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
    // An address set by an admin is trusted as confirmed.
    "UPDATE users SET role = ?, max_servers = ?, max_ram_mb = ?, disabled = ?, email = ?, email_verified = ? WHERE id = ?",
    patch.role ?? u.role,
    patch.maxServers ?? u.max_servers,
    patch.maxRamMb ?? u.max_ram_mb,
    patch.disabled === undefined ? u.disabled : patch.disabled ? 1 : 0,
    patch.email === undefined ? u.email : patch.email,
    patch.email === undefined ? u.email_verified : patch.email ? 1 : 0,
    id,
  );
  return getUser(id);
}

export function deleteUser(id: number): void {
  if (one("SELECT 1 FROM servers WHERE owner_id = ?", id)) throw conflict("Сначала удалите или передайте серверы пользователя");
  run("DELETE FROM users WHERE id = ?", id);
}

/** Stores when and which edition of the personal data consent the user accepted. */
export function recordConsent(userId: number, version: string, now = Date.now()): void {
  run("UPDATE users SET consent_at = ?, consent_version = ? WHERE id = ?", now, version, userId);
}
