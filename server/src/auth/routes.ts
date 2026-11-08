import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { audit, listAudit } from "../lib/audit.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { badRequest, conflict, HttpError } from "../lib/errors.js";
import { logAuthFailure } from "../lib/log.js";
import { confirmEmailMail, emailChangedMail, passwordChangedMail, resetPasswordMail, sendMail, type Mail } from "../lib/mailer.js";
import { getSettings, mailConfigured } from "../lib/settings.js";
import { parse } from "../lib/validate.js";
import { run } from "../db/index.js";
import { createApiKey, deleteApiKey, listApiKeys } from "./apiKeys.js";
import { currentUser, requireUser } from "./guard.js";
import { createSession, deleteSession, deleteUserSessions, listSessions, SESSION_COOKIE, SESSION_TTL_MS } from "./sessions.js";
import {
  cancelEmailVerification,
  canSendReset,
  checkReset,
  confirmLink,
  consumeReset,
  createEmailVerification,
  createReset,
  failResetAttempt,
  pendingEmail,
  RESET_TTL_MS,
  resetLink,
  takeEmailVerification,
  VERIFY_TTL_MS,
} from "./passwordReset.js";
import { newTotpSecret, totpSetupData, verifyTotp } from "./totp.js";
import {
  burnPasswordCheck,
  countUsers,
  createUser,
  emailTaken,
  findByUsername,
  findByVerifiedEmail,
  getUser,
  setPassword,
  setVerifiedEmail,
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
const mailLimit = { rateLimit: { max: 5, timeWindow: "10 minutes" } };
const emailSchema = z.string().trim().toLowerCase().max(200).email("Некорректный адрес почты");

const brand = () => {
  const s = getSettings();
  return { panelName: s.panelName, panelUrl: s.panelUrl };
};

/** Fire-and-forget: the HTTP answer must not depend on (or leak) whether a mail went out. */
function mailLater(req: FastifyRequest, to: string, mail: Omit<Mail, "to">): void {
  sendMail({ to, ...mail }).catch((err: Error) => req.log.warn({ err: err.message }, "mail not sent"));
}

function requireMail(): void {
  if (!mailConfigured()) throw new HttpError(503, "Почта на панели ещё не настроена. Попросите администратора: «Настройки панели» → «Почта».");
}

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
    // An address typed at sign-up is used for resets only after its owner opens the confirmation link.
    const confirmByMail = Boolean(body.email) && mailConfigured();
    const user = await createUser({ username: body.username, email: confirmByMail ? null : body.email || null, password: body.password, role: "user" });
    if (confirmByMail && body.email) {
      const token = createEmailVerification(user.id, body.email.toLowerCase());
      mailLater(req, body.email, confirmEmailMail(brand(), { username: user.username, link: confirmLink(getSettings().panelUrl, token), hours: VERIFY_TTL_MS / 3600_000 }));
    }
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
    const user = currentUser(req);
    return { user: { ...toPublic(user), pendingEmail: pendingEmail(user.id) } };
  });

  // --- password reset by email ---
  app.post("/api/auth/forgot", { config: mailLimit }, async (req) => {
    const { login } = parse(z.object({ login: z.string().trim().min(1, "Введите имя или почту").max(200) }), req.body);
    requireMail();
    const user = login.includes("@") ? findByVerifiedEmail(login.toLowerCase()) : findByUsername(login);
    // Same answer whether or not the account exists, so the form cannot be used to probe usernames.
    if (user && user.email && user.email_verified === 1 && !user.disabled && canSendReset(user.id)) {
      const token = createReset(user.id, req.ip);
      mailLater(req, user.email, resetPasswordMail(brand(), { username: user.username, link: resetLink(getSettings().panelUrl, token), minutes: RESET_TTL_MS / 60_000, ip: req.ip }));
      audit({ userId: user.id, action: "auth.reset_requested", ip: req.ip });
    }
    return { ok: true };
  });

  app.post("/api/auth/reset/check", { config: loginLimit }, async (req) => {
    const { token } = parse(z.object({ token: z.string().max(200) }), req.body);
    const userId = checkReset(token);
    const user = userId === null ? undefined : getUser(userId);
    if (!user || user.disabled) return { valid: false };
    return { valid: true, username: user.username, needTotp: Boolean(user.totp_enabled && user.totp_secret) };
  });

  app.post("/api/auth/reset", { config: loginLimit }, async (req) => {
    const body = parse(z.object({ token: z.string().max(200), password: passwordSchema, totp: z.string().max(12).optional() }), req.body);
    const expired = "Ссылка устарела или уже использована. Запросите новую на странице входа.";
    const userId = checkReset(body.token);
    if (userId === null) throw badRequest(expired);
    const user = getUser(userId);
    if (user.disabled) throw new HttpError(403, "Учётная запись отключена");
    // A stolen mailbox alone must not be enough when the account has 2FA.
    if (user.totp_enabled && user.totp_secret) {
      if (!body.totp) return { needTotp: true };
      if (!verifyTotp(user.username, decrypt(user.totp_secret, config.SECRET_KEY), body.totp)) {
        const left = failResetAttempt(body.token);
        await logAuthFailure(req.ip, user.username);
        throw new HttpError(401, left > 0 ? `Неверный код 2FA. Осталось попыток: ${left}` : "Неверный код 2FA. Ссылка больше не действует, запросите новую.");
      }
    }
    if (consumeReset(body.token) !== userId) throw badRequest(expired);
    await setPassword(user.id, body.password);
    deleteUserSessions(user.id);
    audit({ userId: user.id, action: "auth.password_reset", ip: req.ip });
    if (user.email) mailLater(req, user.email, passwordChangedMail(brand(), { username: user.username, ip: req.ip }));
    return { ok: true };
  });

  // --- own email: optional, confirmed by a link before it is used for resets ---
  app.put("/api/auth/email", { preHandler: requireUser, config: mailLimit }, async (req) => {
    const body = parse(z.object({ email: emailSchema.or(z.literal("")), password: z.string().max(200) }), req.body);
    const user = currentUser(req);
    if (!(await verifyPassword(user.password_hash, body.password))) throw badRequest("Пароль неверен");
    if (!body.email) {
      cancelEmailVerification(user.id);
      setVerifiedEmail(user.id, null);
      if (user.email && user.email_verified && mailConfigured()) mailLater(req, user.email, emailChangedMail(brand(), { username: user.username, newEmail: null }));
      audit({ userId: user.id, action: "auth.email_removed", ip: req.ip });
      return { user: { ...toPublic(getUser(user.id)), pendingEmail: null } };
    }
    if (user.email === body.email && user.email_verified) return { user: { ...toPublic(user), pendingEmail: null } };
    if (emailTaken(body.email, user.id)) throw conflict("Эта почта уже привязана к другому аккаунту");
    requireMail();
    const token = createEmailVerification(user.id, body.email);
    await sendMail({ to: body.email, ...confirmEmailMail(brand(), { username: user.username, link: confirmLink(getSettings().panelUrl, token), hours: VERIFY_TTL_MS / 3600_000 }) }).catch((err: Error) => {
      cancelEmailVerification(user.id);
      throw new HttpError(502, `Не удалось отправить письмо: ${err.message}`);
    });
    audit({ userId: user.id, action: "auth.email_confirm_sent", details: { email: body.email }, ip: req.ip });
    return { user: { ...toPublic(user), pendingEmail: body.email } };
  });

  app.post("/api/auth/email/cancel", { preHandler: requireUser }, async (req) => {
    cancelEmailVerification(currentUser(req).id);
    return { ok: true };
  });

  app.post("/api/auth/email/confirm", { config: loginLimit }, async (req) => {
    const { token } = parse(z.object({ token: z.string().max(200) }), req.body);
    const r = takeEmailVerification(token);
    if (!r) throw badRequest("Ссылка устарела или уже использована. Добавьте почту ещё раз в «Аккаунте».");
    const user = getUser(r.userId);
    if (emailTaken(r.email, user.id)) throw conflict("Эта почта уже привязана к другому аккаунту");
    setVerifiedEmail(user.id, r.email);
    if (user.email && user.email_verified && user.email !== r.email) mailLater(req, user.email, emailChangedMail(brand(), { username: user.username, newEmail: r.email }));
    audit({ userId: user.id, action: "auth.email_confirmed", details: { email: r.email }, ip: req.ip });
    return { ok: true, email: r.email };
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
