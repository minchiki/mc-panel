import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/guard.js";
import { deleteUser, verifyPassword } from "../auth/users.js";
import { verifyTotp } from "../auth/totp.js";
import { config } from "../config.js";
import { all, one, run } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { decrypt } from "../lib/crypto.js";
import { badRequest, conflict, HttpError } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { SESSION_COOKIE } from "../auth/sessions.js";

/**
 * Data subject rights (152-FZ art. 14 and 21): a user can download everything the panel keeps
 * about them and withdraw consent by deleting their own account, without asking the admin.
 */
export async function privacyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/auth/my-data", { preHandler: requireUser, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const u = currentUser(req);
    const row = one<Record<string, unknown>>(
      "SELECT id, username, email, email_verified, role, totp_enabled, max_servers, max_ram_mb, disabled, created_at, consent_at, consent_version FROM users WHERE id = ?",
      u.id,
    );
    const iso = (ms: unknown) => (typeof ms === "number" ? new Date(ms).toISOString() : null);
    const data = {
      exportedAt: new Date().toISOString(),
      note: "Все данные о вас, которые хранит эта панель. Пароль хранится только в виде хэша, секрет 2FA зашифрован: они в выгрузку не входят.",
      account: row && {
        ...row,
        email_verified: Boolean(row.email_verified),
        totp_enabled: Boolean(row.totp_enabled),
        disabled: Boolean(row.disabled),
        created_at: iso(row.created_at),
        consent_at: iso(row.consent_at),
      },
      sessions: all<{ created_at: number; expires_at: number; ip: string | null; user_agent: string | null }>(
        "SELECT created_at, expires_at, ip, user_agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC",
        u.id,
      ).map((s) => ({ ...s, created_at: iso(s.created_at), expires_at: iso(s.expires_at) })),
      apiKeys: all<{ name: string; prefix: string; created_at: number; last_used_at: number | null }>(
        "SELECT name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ?",
        u.id,
      ).map((k) => ({ ...k, created_at: iso(k.created_at), last_used_at: iso(k.last_used_at) })),
      serversOwned: all<{ id: string; name: string; core: string; mc_version: string; created_at: number }>(
        "SELECT id, name, core, mc_version, created_at FROM servers WHERE owner_id = ?",
        u.id,
      ).map((s) => ({ ...s, created_at: iso(s.created_at) })),
      serverAccess: all("SELECT server_id, permissions FROM subusers WHERE user_id = ?", u.id),
      activityLog: all<{ created_at: number; action: string; server_id: string | null; details: string | null; ip: string | null }>(
        "SELECT created_at, action, server_id, details, ip FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 5000",
        u.id,
      ).map((a) => ({ ...a, created_at: iso(a.created_at) })),
    };
    audit({ userId: u.id, action: "auth.data_export", ip: req.ip });
    reply.header("Content-Disposition", `attachment; filename="mc-panel-${u.username}-data.json"`);
    reply.header("Cache-Control", "no-store");
    return data;
  });

  app.post("/api/auth/delete-account", { preHandler: requireUser, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const body = parse(z.object({ password: z.string().min(1).max(200), totp: z.string().max(12).optional(), confirm: z.literal("УДАЛИТЬ", { error: "Впишите слово УДАЛИТЬ" }) }), req.body);
    const u = currentUser(req);
    if (!(await verifyPassword(u.password_hash, body.password))) throw new HttpError(401, "Неверный пароль");
    if (u.totp_enabled && u.totp_secret) {
      if (!body.totp) return { needTotp: true };
      if (!verifyTotp(u.username, decrypt(u.totp_secret, config.SECRET_KEY), body.totp)) throw new HttpError(401, "Неверный код 2FA");
    }
    if (u.role === "admin" && (one<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0")?.n ?? 0) <= 1) {
      throw conflict("Вы единственный администратор: сначала назначьте другого, иначе панелью некому будет управлять");
    }
    if (one("SELECT 1 FROM servers WHERE owner_id = ?", u.id)) throw badRequest("Сначала удалите свои серверы или попросите администратора передать их другому пользователю");
    // The subject's activity log goes with the account; a neutral record keeps the fact of deletion.
    run("DELETE FROM audit_log WHERE user_id = ?", u.id);
    run("DELETE FROM subusers WHERE user_id = ?", u.id);
    deleteUser(u.id);
    audit({ userId: null, action: "auth.self_delete", details: { id: u.id } });
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}
