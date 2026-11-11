import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession, SESSION_COOKIE } from "../auth/sessions.js";
import { createUser } from "../auth/users.js";
import { openDb, run } from "../db/index.js";
import { HttpError } from "../lib/errors.js";
import { insertServer } from "../servers/repo.js";
import { serverExtraRoutes } from "./serverExtras.js";

// A sub-user allowed to manage schedules must not use them to do what they are not allowed to do directly.
const ID = "schedtst";
let app: FastifyInstance;
let limited = "";
let full = "";

beforeAll(async () => {
  openDb(mkdtempSync(join(tmpdir(), "mcp-sched-")));
  const owner = await createUser({ username: "owner", password: "long-password-1", role: "user" });
  const sub = await createUser({ username: "helper", password: "long-password-1", role: "user" });
  const sub2 = await createUser({ username: "operator", password: "long-password-1", role: "user" });
  insertServer({
    id: ID, owner_id: owner.id, name: "Test", core: "paper", mc_version: "1.21.4", core_build: null, java_version: 21,
    ram_mb: 1024, cpu_limit: 1, disk_mb: 1024, port: 25598, startup: "", jvm_flags: "", domain: null,
    desired_state: "stopped", install_state: "installed", auto_restart: 0, rcon_password: "x",
  });
  run("INSERT INTO subusers (server_id, user_id, permissions) VALUES (?, ?, ?)", ID, sub.id, "schedules,monitor");
  run("INSERT INTO subusers (server_id, user_id, permissions) VALUES (?, ?, ?)", ID, sub2.id, "schedules,console,power,monitor");
  limited = createSession(sub.id, "127.0.0.1", "test");
  full = createSession(sub2.id, "127.0.0.1", "test");
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => reply.status(err instanceof HttpError ? err.status : 500).send({ error: err.message }));
  await app.register(cookie);
  await app.register(serverExtraRoutes);
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const save = (token: string, body: object) =>
  app.inject({
    method: "POST",
    url: `/api/servers/${ID}/schedules`,
    headers: { "x-requested-with": "mc-panel" },
    cookies: { [SESSION_COOKIE]: token },
    payload: { name: "t", cron: "0 4 * * *", enabled: false, ...body },
  });

describe("schedules", () => {
  it("a schedules-only sub-user cannot run console commands or power actions through them", async () => {
    expect((await save(limited, { action: "command", payload: "op helper" })).statusCode).toBe(403);
    expect((await save(limited, { action: "stop" })).statusCode).toBe(403);
    expect((await save(limited, { action: "backup" })).statusCode).toBe(403);
  });

  it("a sub-user with the matching permission can", async () => {
    expect((await save(full, { action: "command", payload: "say hi" })).statusCode).toBe(200);
    expect((await save(full, { action: "restart" })).statusCode).toBe(200);
  });
});
