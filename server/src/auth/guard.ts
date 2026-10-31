import type { FastifyReply, FastifyRequest } from "fastify";
import { one } from "../db/index.js";
import { forbidden, HttpError, notFound } from "../lib/errors.js";
import { API_KEY_PREFIX, apiKeyUserId } from "./apiKeys.js";
import { parsePermissions, SERVER_PERMISSIONS, type ServerPermission } from "./permissions.js";
import { SESSION_COOKIE, sessionUserId } from "./sessions.js";
import { findById, type UserRow } from "./users.js";

export interface AuthContext {
  user: UserRow;
  via: "session" | "apikey";
  sessionToken?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "mc-panel";

/** Resolves the caller from the session cookie or `Authorization: Bearer mcp_...`. */
export function resolveAuth(req: FastifyRequest): AuthContext | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const key = header.slice(7).trim();
    if (!key.startsWith(API_KEY_PREFIX)) return undefined;
    const userId = apiKeyUserId(key);
    const user = userId ? findById(userId) : undefined;
    return user && !user.disabled ? { user, via: "apikey" } : undefined;
  }
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return undefined;
  const userId = sessionUserId(token);
  const user = userId ? findById(userId) : undefined;
  return user && !user.disabled ? { user, via: "session", sessionToken: token } : undefined;
}

export async function requireUser(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const auth = resolveAuth(req);
  if (!auth) throw new HttpError(401, "Требуется вход");
  // Cookie-authenticated writes must carry a custom header: browsers cannot add it
  // cross-site without a CORS preflight, which we never allow. Together with
  // SameSite=Strict this is the CSRF defence.
  if (auth.via === "session" && !["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
    throw new HttpError(403, "Запрос отклонён (CSRF)");
  }
  req.auth = auth;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireUser(req, reply);
  if (req.auth!.user.role !== "admin") throw forbidden();
}

export function currentUser(req: FastifyRequest): UserRow {
  if (!req.auth) throw new HttpError(401, "Требуется вход");
  return req.auth.user;
}

export interface ServerAccess {
  isOwner: boolean;
  permissions: ServerPermission[];
}

/** Effective permissions of `user` on server `serverId`; throws 404 when it has none. */
export function serverAccess(user: UserRow, serverId: string): ServerAccess {
  const server = one<{ owner_id: number }>("SELECT owner_id FROM servers WHERE id = ?", serverId);
  if (!server) throw notFound("Сервер");
  if (user.role === "admin" || server.owner_id === user.id) {
    return { isOwner: true, permissions: [...SERVER_PERMISSIONS] };
  }
  const sub = one<{ permissions: string }>("SELECT permissions FROM subusers WHERE server_id = ? AND user_id = ?", serverId, user.id);
  // 404 rather than 403 so server ids cannot be probed.
  if (!sub) throw notFound("Сервер");
  return { isOwner: false, permissions: parsePermissions(sub.permissions) };
}

export function assertServerPermission(user: UserRow, serverId: string, permission: ServerPermission | "owner"): ServerAccess {
  const access = serverAccess(user, serverId);
  if (permission === "owner" ? !access.isOwner : !access.permissions.includes(permission)) throw forbidden();
  return access;
}
