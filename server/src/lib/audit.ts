import { all, run } from "../db/index.js";

export interface AuditEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  server_id: string | null;
  action: string;
  details: string | null;
  ip: string | null;
  created_at: number;
}

export function audit(entry: { userId?: number | null; serverId?: string | null; action: string; details?: unknown; ip?: string }): void {
  const details = entry.details === undefined ? null : typeof entry.details === "string" ? entry.details : JSON.stringify(entry.details);
  run(
    "INSERT INTO audit_log (user_id, server_id, action, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    entry.userId ?? null,
    entry.serverId ?? null,
    entry.action,
    details,
    entry.ip ?? null,
    Date.now(),
  );
}

/** Audit entries (they hold IP addresses) are kept for a year, as the privacy policy promises. */
export const AUDIT_RETENTION_MS = 365 * 24 * 3600_000;

/** Deletes old audit entries and spent password-reset / email-confirmation tokens. */
export function pruneOldRecords(now = Date.now()): void {
  run("DELETE FROM audit_log WHERE created_at < ?", now - AUDIT_RETENTION_MS);
  run("DELETE FROM password_resets WHERE expires_at < ?", now - 24 * 3600_000);
  run("DELETE FROM email_verifications WHERE expires_at < ?", now);
}

export function listAudit(filter: { userId?: number; serverId?: string; limit?: number; before?: number }): AuditEntry[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.userId !== undefined) {
    where.push("a.user_id = ?");
    params.push(filter.userId);
  }
  if (filter.serverId !== undefined) {
    where.push("a.server_id = ?");
    params.push(filter.serverId);
  }
  if (filter.before !== undefined) {
    where.push("a.id < ?");
    params.push(filter.before);
  }
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  return all<AuditEntry>(
    `SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.id DESC LIMIT ${limit}`,
    ...params,
  );
}
