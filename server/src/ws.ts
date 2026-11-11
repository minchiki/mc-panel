import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { resolveAuth, serverAccess } from "./auth/guard.js";
import { audit } from "./lib/audit.js";
import { errorMessage } from "./lib/errors.js";
import { bus, type ServerEvent } from "./servers/events.js";
import { runtime, sendCommand } from "./servers/runtime.js";

type ClientMsg = { type: "subscribe"; serverId: string } | { type: "unsubscribe"; serverId: string } | { type: "command"; serverId: string; command: string };

const MAX_COMMANDS_PER_10S = 20;

/**
 * One socket per browser tab. Clients subscribe to servers they can see; status
 * events go to everyone with access, console/stats only to subscribers.
 */
export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/ws", { websocket: true }, (socket: WebSocket, req) => {
    const origin = req.headers.origin;
    const host = req.headers["x-forwarded-host"] ?? req.headers.host;
    if (origin && host && new URL(origin).host !== host) {
      socket.close(4403, "bad origin");
      return;
    }
    const auth = resolveAuth(req);
    if (!auth) {
      socket.close(4401, "unauthorized");
      return;
    }
    let user = auth.user;
    const subscribed = new Set<string>();
    // The session is re-checked (at most every few seconds, always before a command): logging out,
    // a password change, blocking the account or removing a role must reach an already open socket.
    let checkedAt = Date.now();
    const stillValid = (force = false): boolean => {
      if (!force && Date.now() - checkedAt < 5_000) return true;
      checkedAt = Date.now();
      const fresh = resolveAuth(req);
      if (!fresh || fresh.user.id !== user.id) {
        socket.close(4401, "session ended");
        return false;
      }
      user = fresh.user;
      return true;
    };
    const commandTimes: number[] = [];

    const send = (data: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(data));
    };

    const canSee = (serverId: string, perm: "console" | "monitor", force = false) => {
      if (!stillValid(force)) return false;
      try {
        return serverAccess(user, serverId).permissions.includes(perm);
      } catch {
        return false;
      }
    };

    const off = bus.onServer((evt: ServerEvent) => {
      if (evt.type === "status") {
        if (canSee(evt.serverId, "monitor")) send(evt);
        return;
      }
      if (!subscribed.has(evt.serverId)) return;
      if (evt.type === "console" && !canSee(evt.serverId, "console")) return;
      send(evt);
    });

    socket.on("message", (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw)) as ClientMsg;
      } catch {
        return;
      }
      if (typeof msg.serverId !== "string") return;
      if (msg.type === "subscribe") {
        if (!canSee(msg.serverId, "monitor")) return send({ type: "error", message: "Нет доступа" });
        subscribed.add(msg.serverId);
        const rt = runtime(msg.serverId);
        send({ type: "status", serverId: msg.serverId, status: rt.status });
        if (canSee(msg.serverId, "console")) send({ type: "console", serverId: msg.serverId, lines: rt.console, replace: true });
        if (rt.stats) send({ type: "stats", serverId: msg.serverId, stats: rt.stats });
        send({ type: "players", serverId: msg.serverId, players: [...rt.players] });
      } else if (msg.type === "unsubscribe") {
        subscribed.delete(msg.serverId);
      } else if (msg.type === "command") {
        if (!canSee(msg.serverId, "console", true) || typeof msg.command !== "string") return;
        const now = Date.now();
        while (commandTimes.length && now - commandTimes[0]! > 10_000) commandTimes.shift();
        if (commandTimes.length >= MAX_COMMANDS_PER_10S) return send({ type: "error", message: "Слишком много команд, подождите" });
        commandTimes.push(now);
        try {
          sendCommand(msg.serverId, msg.command.slice(0, 1000));
          audit({ userId: user.id, serverId: msg.serverId, action: "server.command", details: { command: msg.command.slice(0, 200) }, ip: req.ip });
        } catch (err) {
          send({ type: "error", message: errorMessage(err) });
        }
      }
    });

    const ping = setInterval(() => socket.ping(), 25_000);
    socket.on("close", () => {
      clearInterval(ping);
      off();
    });
  });
}
