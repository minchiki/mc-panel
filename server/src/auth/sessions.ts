import { all, one, run } from "../db/index.js";
import { randomToken, sha256 } from "../lib/crypto.js";

export const SESSION_COOKIE = "mcp_session";
export const SESSION_TTL_MS = 30 * 24 * 3600_000;

export function createSession(userId: number, ip: string, userAgent: string): string {
  const token = randomToken();
  const now = Date.now();
  run(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
    sha256(token),
    userId,
    now,
    now + SESSION_TTL_MS,
    ip,
    userAgent.slice(0, 200),
  );
  return token;
}

export function sessionUserId(token: string): number | null {
  const row = one<{ user_id: number; expires_at: number }>(
    "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
    sha256(token),
  );
  if (!row || row.expires_at < Date.now()) return null;
  return row.user_id;
}

export function deleteSession(token: string): void {
  run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
}

/** Logs out everywhere except, optionally, the current session. */
export function deleteUserSessions(userId: number, keepToken?: string): void {
  if (keepToken) run("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", userId, sha256(keepToken));
  else run("DELETE FROM sessions WHERE user_id = ?", userId);
}

export function listSessions(userId: number) {
  return all<{ created_at: number; ip: string; user_agent: string }>(
    "SELECT created_at, ip, user_agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC",
    userId,
    Date.now(),
  );
}

export function purgeExpiredSessions(): void {
  run("DELETE FROM sessions WHERE expires_at < ?", Date.now());
}
