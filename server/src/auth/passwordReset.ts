import { one, run } from "../db/index.js";
import { randomToken, sha256 } from "../lib/crypto.js";

/** A reset link lives 30 minutes and works once; only its SHA-256 is stored. */
export const RESET_TTL_MS = 30 * 60_000;
/** At most one email per minute and five per hour for the same account. */
const COOLDOWN_MS = 60_000;
const HOURLY_LIMIT = 5;
/** Wrong 2FA codes allowed on one link before it is burned. */
export const MAX_TOTP_ATTEMPTS = 5;

interface ResetRow {
  token_hash: string;
  user_id: number;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  attempts: number;
}

/** False when the account already got a link very recently (stops mail bombing). */
export function canSendReset(userId: number, now = Date.now()): boolean {
  const last = one<{ t: number | null }>("SELECT MAX(created_at) AS t FROM password_resets WHERE user_id = ?", userId)?.t ?? 0;
  if (now - last < COOLDOWN_MS) return false;
  const hourly = one<{ n: number }>("SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > ?", userId, now - 3600_000)?.n ?? 0;
  return hourly < HOURLY_LIMIT;
}

/** New link token; every older unused link of the user stops working. */
export function createReset(userId: number, ip: string, now = Date.now()): string {
  run("DELETE FROM password_resets WHERE created_at < ?", now - 24 * 3600_000);
  run("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL", now, userId);
  const token = randomToken(32);
  run(
    "INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, ip) VALUES (?, ?, ?, ?, ?)",
    sha256(token),
    userId,
    now,
    now + RESET_TTL_MS,
    ip,
  );
  return token;
}

/** The user id behind a token that is unused, not expired and not burned by wrong 2FA codes. */
export function checkReset(token: string, now = Date.now()): number | null {
  if (!/^[\w-]{20,100}$/.test(token)) return null;
  const row = one<ResetRow>("SELECT * FROM password_resets WHERE token_hash = ?", sha256(token));
  if (!row || row.used_at !== null || row.expires_at <= now || row.attempts >= MAX_TOTP_ATTEMPTS) return null;
  return row.user_id;
}

/** Counts a wrong 2FA code; the link is burned after MAX_TOTP_ATTEMPTS. Returns attempts left. */
export function failResetAttempt(token: string): number {
  run("UPDATE password_resets SET attempts = attempts + 1 WHERE token_hash = ?", sha256(token));
  const n = one<{ attempts: number }>("SELECT attempts FROM password_resets WHERE token_hash = ?", sha256(token))?.attempts ?? MAX_TOTP_ATTEMPTS;
  return Math.max(0, MAX_TOTP_ATTEMPTS - n);
}

/** Marks the token used; atomic, so two parallel requests can't both reset the password. */
export function consumeReset(token: string, now = Date.now()): number | null {
  const userId = checkReset(token, now);
  if (userId === null) return null;
  const res = run(
    "UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? AND attempts < ?",
    now,
    sha256(token),
    now,
    MAX_TOTP_ATTEMPTS,
  );
  return res.changes === 1 ? userId : null;
}

/** Link for the email. The token goes after "#", so it never reaches server logs or Referer headers. */
export function resetLink(panelUrl: string, token: string): string {
  return `${panelUrl.replace(/\/+$/, "")}/reset-password#token=${token}`;
}

// ------------------------------------------------------------- email confirmation

/** A confirmation link lives a day; the address becomes the account's email only after it is opened. */
export const VERIFY_TTL_MS = 24 * 3600_000;

export function createEmailVerification(userId: number, email: string, now = Date.now()): string {
  run("DELETE FROM email_verifications WHERE user_id = ? OR expires_at < ?", userId, now);
  const token = randomToken(32);
  run("INSERT INTO email_verifications (token_hash, user_id, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", sha256(token), userId, email, now, now + VERIFY_TTL_MS);
  return token;
}

/** Address waiting for confirmation, if any. */
export function pendingEmail(userId: number, now = Date.now()): string | null {
  return one<{ email: string }>("SELECT email FROM email_verifications WHERE user_id = ? AND expires_at > ?", userId, now)?.email ?? null;
}

/** Atomically takes a confirmation token: returns who confirmed which address, or null. */
export function takeEmailVerification(token: string, now = Date.now()): { userId: number; email: string } | null {
  if (!/^[\w-]{20,100}$/.test(token)) return null;
  const row = one<{ user_id: number; email: string; expires_at: number }>("SELECT user_id, email, expires_at FROM email_verifications WHERE token_hash = ?", sha256(token));
  if (!row || row.expires_at <= now) return null;
  const res = run("DELETE FROM email_verifications WHERE token_hash = ?", sha256(token));
  return res.changes === 1 ? { userId: row.user_id, email: row.email } : null;
}

export function cancelEmailVerification(userId: number): void {
  run("DELETE FROM email_verifications WHERE user_id = ?", userId);
}

/** Link for the confirmation email; the token stays after "#" like the reset link. */
export function confirmLink(panelUrl: string, token: string): string {
  return `${panelUrl.replace(/\/+$/, "")}/confirm-email#token=${token}`;
}
