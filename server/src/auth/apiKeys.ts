import { all, one, run } from "../db/index.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { notFound } from "../lib/errors.js";

export const API_KEY_PREFIX = "mcp_";

export function createApiKey(userId: number, name: string): { id: number; key: string } {
  const key = `${API_KEY_PREFIX}${randomToken(30)}`;
  const res = run(
    "INSERT INTO api_keys (user_id, name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    userId,
    name,
    key.slice(0, 10),
    sha256(key),
    Date.now(),
  );
  return { id: res.lastInsertRowid, key };
}

export function apiKeyUserId(key: string): number | null {
  const row = one<{ id: number; user_id: number }>("SELECT id, user_id FROM api_keys WHERE key_hash = ?", sha256(key));
  if (!row) return null;
  run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", Date.now(), row.id);
  return row.user_id;
}

export function listApiKeys(userId: number) {
  return all<{ id: number; name: string; prefix: string; created_at: number; last_used_at: number | null }>(
    "SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY id DESC",
    userId,
  );
}

export function deleteApiKey(userId: number, id: number): void {
  if (run("DELETE FROM api_keys WHERE id = ? AND user_id = ?", id, userId).changes === 0) throw notFound("Ключ");
}
