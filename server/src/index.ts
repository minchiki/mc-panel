import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import tls from "node:tls";
import { config } from "./config.js";
import { openDb } from "./db/index.js";
import { authRoutes } from "./auth/routes.js";
import { purgeExpiredSessions } from "./auth/sessions.js";
import { pruneOldRecords } from "./lib/audit.js";
import { HttpError } from "./lib/errors.js";
import { publicSettings } from "./lib/settings.js";
import { adminRoutes } from "./routes/admin.js";
import { aiRoutes } from "./routes/ai.js";
import { fileRoutes } from "./routes/files.js";
import { iconRoutes } from "./routes/icon.js";
import { modlistRoutes } from "./routes/modlist.js";
import { mrpackRoutes } from "./routes/mrpack.js";
import { serverConfigRoutes } from "./routes/serverConfig.js";
import { serverExtraRoutes } from "./routes/serverExtras.js";
import { serverRoutes } from "./routes/servers.js";
import { loadAllSchedules } from "./schedules/service.js";
import { startMetricsCollector } from "./servers/metrics.js";
import { startPingSync } from "./servers/ping.js";
import { reconcileAll } from "./servers/runtime.js";
import { wsRoutes } from "./ws.js";

const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

// Happy Eyeballs gives each address only ~250 ms by default; on lossy routes
// (dropped first SYN, seen to Cloudflare from RU) every address then fails with
// ETIMEDOUT before the kernel even retransmits. Give each attempt real time.
setDefaultAutoSelectFamilyAttemptTimeout(3000);

// OpenSSL 3.5 (Node 22.23+) offers a hybrid post-quantum key share, which makes
// the ClientHello span several packets. Some paths to Cloudflare drop those, so
// fetch died with UND_ERR_CONNECT_TIMEOUT 3 times out of 10 while curl was fine.
tls.DEFAULT_ECDH_CURVE = "X25519:prime256v1:secp384r1";

async function main(): Promise<void> {
  openDb(config.DATA_DIR);
  await Promise.all([config.SERVERS_DIR, config.BACKUPS_DIR, config.LOG_DIR].map((d) => mkdir(d, { recursive: true })));

  const app = Fastify({
    logger: { level: "info" },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Modrinth/Hangar/Spigot icons + generated QR data URLs.
        imgSrc: ["'self'", "data:", "https:"],
        // Monaco needs blob: workers and inline styles.
        workerSrc: ["'self'", "blob:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    // Panel may run on plain HTTP by IP until a domain is attached.
    hsts: false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 50 } });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    const { statusCode: status, message } = err as { statusCode?: number; message?: string };
    if (status && status < 500) return reply.status(status).send({ error: message ?? "Ошибка запроса" });
    req.log.error(err);
    return reply.status(500).send({ error: "Внутренняя ошибка сервера. Подробности в журнале панели." });
  });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/public-settings", async () => publicSettings());

  await app.register(authRoutes);
  await app.register(aiRoutes);
  await app.register(serverRoutes);
  await app.register(serverConfigRoutes);
  await app.register(fileRoutes);
  await app.register(iconRoutes);
  await app.register(modlistRoutes);
  await app.register(mrpackRoutes);
  await app.register(serverExtraRoutes);
  await app.register(adminRoutes);
  await app.register(wsRoutes);

  const webDir = config.WEB_DIR || join(process.cwd(), "..", "web", "dist");
  if (existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false });
    // SPA fallback for client-side routes.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.status(404).send({ error: "Не найдено" });
      return reply.sendFile("index.html");
    });
  }

  await app.listen({ host: config.HOST, port: config.PORT });

  loadAllSchedules();
  startMetricsCollector();
  startPingSync();
  setInterval(() => {
    purgeExpiredSessions();
    pruneOldRecords();
  }, 3600_000);
  pruneOldRecords();
  reconcileAll().catch((err) => app.log.error(err, "reconcile failed"));

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    // Game containers keep running; the next panel start re-attaches to them.
    process.on(signal, () => void app.close().then(() => process.exit(0)));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
