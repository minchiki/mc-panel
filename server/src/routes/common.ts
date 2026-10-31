import type { FastifyRequest } from "fastify";
import { assertServerPermission, currentUser, type ServerAccess } from "../auth/guard.js";
import type { ServerPermission } from "../auth/permissions.js";
import { config } from "../config.js";
import { audit } from "../lib/audit.js";
import { getServer, type ServerRow } from "../servers/repo.js";
import { runtime } from "../servers/runtime.js";

export type IdParams = { Params: { id: string } };

/** Loads the server from `:id` and checks the caller has `permission` on it. */
export function serverFor(req: FastifyRequest, permission: ServerPermission | "owner"): { server: ServerRow; access: ServerAccess } {
  const id = (req.params as { id: string }).id;
  const access = assertServerPermission(currentUser(req), id, permission);
  return { server: getServer(id), access };
}

export function auditServer(req: FastifyRequest, serverId: string, action: string, details?: unknown): void {
  audit({ userId: req.auth?.user.id ?? null, serverId, action, details, ip: req.ip });
}

export function connectAddress(server: ServerRow): string {
  const host = server.domain || config.PUBLIC_HOST;
  return server.port === 25565 ? host : `${host}:${server.port}`;
}

export function serverView(server: ServerRow, access?: ServerAccess) {
  const rt = runtime(server.id);
  return {
    id: server.id,
    name: server.name,
    ownerId: server.owner_id,
    core: server.core,
    mcVersion: server.mc_version,
    coreBuild: server.core_build,
    javaVersion: server.java_version,
    ramMb: server.ram_mb,
    cpuLimit: server.cpu_limit,
    diskMb: server.disk_mb,
    port: server.port,
    domain: server.domain,
    address: connectAddress(server),
    jvmFlags: server.jvm_flags,
    autoRestart: server.auto_restart === 1,
    installState: server.install_state,
    desiredState: server.desired_state,
    status: rt.status,
    players: [...rt.players],
    stats: rt.stats,
    tps: rt.tps,
    startedAt: rt.startedAt,
    createdAt: server.created_at,
    permissions: access?.permissions,
    isOwner: access?.isOwner,
  };
}
