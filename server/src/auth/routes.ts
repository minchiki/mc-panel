import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { audit, listAudit } from "../lib/audit.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { badRequest, HttpError } from "../lib/errors.js";
import { logAuthFailure } from "../lib/log.js";
import { getSettings } from "../lib/settings.js";
import { parse } from "../lib/validate.js";
import { run } from "../db/index.js";
import { createApiKey, deleteApiKey, listApiKeys } from "./apiKeys.js";
import { currentUser, requireUser } from "./guard.js";
import { createSession, deleteSession, deleteUserSessions, listSessions, SESSION_COOKIE, SESSION_TTL_MS } from "./sessions.js";
import { newTotpSecret, totpSetupData, verifyTotp } from "./totp.js";
import {
  burnPasswordCheck,
  countUsers,
  createUser,
  findByUsername,
  getUser,
  setPassword,
  toPublic,
  verifyPassword,
} from "./users.js";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Имя: минимум 3 символа")
  .max(32, "Имя: максимум 32 символа")
  .regex(/^[a-zA-Z0-9_.-]+$/, "Имя: только латиница, цифры, _ . -");
export const passwordSchema = z.string().min(10, "Пароль: минимум 10 символов").max(200);

const loginLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string): void {
  const secure = config.SECURE_COOKIES === "auto" ? req.protocol === "https" : config.SECURE_COOKIES === "true";
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/register", { config: loginLimit }, async (req, reply) => {
    const body = parse(
      z.object({ username: usernameSchema, email: z.string().email("Некорректный email").optional().or(z.literal("")), password: passwordSchema }),
      req.body,
    );
    if (!getSettings().registrationEnabled) throw new HttpError(403, "Регистрация отключена администратором");
    const user = await createUser({ username: body.username, email: body.email || null, password: body.password, role: "user" });
    audit({ userId: user.id, action: "auth.register", ip: req.ip });
    setSessionCookie(req, reply, createSession(user.id, req.ip, req.headers["user-agent"] ?? ""));
    return { user: toPublic(user) };
  });

  app.post("/api/auth/login", { config: loginLimit }, async (req, reply) => {
    const body = parse(z.object({ username: z.string().max(64), password: z.string().max(200), totp: z.string().max(12).optional() }), req.body);
    const user = findByUsername(body.username.trim());
    if (!user) {
      await burnPasswordCheck(body.password);
      await logAuthFailure(req.ip, body.username);
      throw new HttpError(401, "Неверное имя пользователя или пароль");
    }
    if (!(await verifyPassword(user.password_hash, body.password))) {
      await logAuthFailure(req.ip, body.username);
      audit({ userId: user.id, action: "auth.login_failed", ip: req.ip });
      throw new HttpError(401, "Неверное имя пользователя или пароль");
    }
    if (user.disabled) throw new HttpError(403, "Учётная запись отключена");
    if (user.totp_enabled && user.totp_secret) {
      if (!body.totp) return { needTotp: true };
      if (!verifyTotp(user.username, decrypt(user.totp_secret, config.SECRET_KEY), body.totp)) {
        await logAuthFailure(req.ip, body.username);
        throw new HttpError(401, "Неверный код 2FA");
      }
    }
    setSessionCookie(req, reply, createSession(user.id, req.ip, req.headers["user-agent"] ?? ""));
    audit({ userId: user.id, action: "auth.login", ip: req.ip });
    return { user: toPublic(user) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireUser }, async (req) => {
    return { user: toPublic(currentUser(req)) };
  });

  app.get("/api/auth/bootstrap", async () => ({ needsSetup: countUsers() === 0 }));

  app.post("/api/auth/password", { preHandler: requireUser, config: loginLimit }, async (req) => {
    const body = parse(z.object({ current: z.string(), next: passwordSchema }), req.body);
    const user = currentUser(req);
    if (!(await verifyPassword(user.password_hash, body.current))) throw badRequest("Текущий пароль неверен");
    await setPassword(user.id, body.next);
    deleteUserSessions(user.id, req.auth?.sessionToken);
    audit({ userId: user.id, action: "auth.password_changed", ip: req.ip });
    return { ok: true };
  });

  app.get("/api/auth/sessions", { preHandler: requireUser }, async (req) => ({ sessions: listSessions(currentUser(req).id) }));

  app.post("/api/auth/sessions/revoke-others", { preHandler: requireUser }, async (req) => {
    deleteUserSessions(currentUser(req).id, req.auth?.sessionToken);
    return { ok: true };
  });

  // --- 2FA ---
  app.post("/api/auth/2fa/setup", { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    if (user.totp_enabled) throw badRequest("2FA уже включена");
    const secret = newTotpSecret();
    run("UPDATE users SET totp_secret = ? WHERE id = ?", encrypt(secret, config.SECRET_KEY), user.id);
    return { secret, ...(await totpSetupData(user.username, secret)) };
  });

  app.post("/api/auth/2fa/enable", { preHandler: requireUser }, async (req) => {
    const { code } = parse(z.object({ code: z.string() }), req.body);
    const user = currentUser(req);
    if (!user.totp_secret) throw badRequest("Сначала начните настройку 2FA");
    if (!verifyTotp(user.username, decrypt(user.totp_secret, config.SECRET_KEY), code)) throw badRequest("Неверный код");
    run("UPDATE users SET totp_enabled = 1 WHERE id = ?", user.id);
    audit({ userId: user.id, action: "auth.2fa_enabled", ip: req.ip });
    return { user: toPublic(getUser(user.id)) };
  });

  app.post("/api/auth/2fa/disable", { preHandler: requireUser }, async (req) => {
    const body = parse(z.object({ password: z.string(), code: z.string() }), req.body);
    const user = currentUser(req);
    if (!user.totp_enabled || !user.totp_secret) throw badRequest("2FA не включена");
    if (!(await verifyPassword(user.password_hash, body.password))) throw badRequest("Пароль неверен");
    if (!verifyTotp(user.username, decrypt(user.totp_secret, config.SECRET_KEY), body.code)) throw badRequest("Неверный код");
    run("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?", user.id);
    audit({ userId: user.id, action: "auth.2fa_disabled", ip: req.ip });
    return { user: toPublic(getUser(user.id)) };
  });

  // --- API keys ---
  app.get("/api/auth/api-keys", { preHandler: requireUser }, async (req) => ({ keys: listApiKeys(currentUser(req).id) }));

  app.post("/api/auth/api-keys", { preHandler: requireUser }, async (req) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(64) }), req.body);
    const user = currentUser(req);
    const created = createApiKey(user.id, name);
    audit({ userId: user.id, action: "auth.api_key_created", details: { name }, ip: req.ip });
    return created;
  });

  app.delete<{ Params: { id: string } }>("/api/auth/api-keys/:id", { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    deleteApiKey(user.id, Number(req.params.id));
    audit({ userId: user.id, action: "auth.api_key_deleted", details: { id: req.params.id }, ip: req.ip });
    return { ok: true };
  });

  app.get<{ Querystring: { before?: string } }>("/api/auth/activity", { preHandler: requireUser }, async (req) => ({
    entries: listAudit({ userId: currentUser(req).id, before: req.query.before ? Number(req.query.before) : undefined }),
  }));
}
