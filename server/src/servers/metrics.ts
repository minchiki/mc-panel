import { config } from "../config.js";
import { all, run } from "../db/index.js";
import { containerIp, containerName, networkName } from "../docker/client.js";
import { notify } from "../lib/notify.js";
import { parseListResponse, parseTpsResponse, rconExec } from "../lib/rcon.js";
import { getSettings } from "../lib/settings.js";
import { hostDisk, serverDiskBytes } from "./disk.js";
import { RCON_PORT, usesServerProperties } from "./prepare.js";
import { listAllServers } from "./repo.js";
import { runtime } from "./runtime.js";

const SAMPLE_EVERY_MS = 30_000;
const RETENTION_MS = 7 * 24 * 3600_000;

export interface MetricPoint {
  ts: number;
  cpu: number | null;
  mem_mb: number | null;
  net_rx: number | null;
  net_tx: number | null;
  disk_mb: number | null;
  players: number | null;
  tps: number | null;
}

async function pollRcon(serverId: string, password: string, core: string): Promise<void> {
  const rt = runtime(serverId);
  const ip = await containerIp(containerName(serverId), networkName(serverId));
  if (!ip) return;
  const list = parseListResponse(await rconExec(ip, RCON_PORT, password, "list"));
  if (list) rt.setPlayers(list.players);
  if (core === "paper" || core === "purpur") {
    rt.tps = parseTpsResponse(await rconExec(ip, RCON_PORT, password, "tps"));
  }
}

async function sampleAll(): Promise<void> {
  const now = Date.now();
  for (const server of listAllServers()) {
    const rt = runtime(server.id);
    const diskMb = (await serverDiskBytes(server.id)) / 1024 / 1024;
    if (diskMb > server.disk_mb) {
      void notify(`quota:${server.id}`, `💾 Сервер «${server.name}» превысил лимит диска: ${Math.round(diskMb)} из ${server.disk_mb} МБ.`, "disk");
    }
    if (rt.status !== "online") continue;
    if (usesServerProperties(server.core)) {
      await pollRcon(server.id, server.rcon_password, server.core).catch(() => undefined);
    }
    const s = rt.stats;
    run(
      "INSERT INTO metrics (server_id, ts, cpu, mem_mb, net_rx, net_tx, disk_mb, players, tps) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      server.id,
      now,
      s?.cpu ?? null,
      s?.memMb ?? null,
      s?.netRx ?? null,
      s?.netTx ?? null,
      Math.round(diskMb),
      rt.players.size,
      rt.tps,
    );
  }
  run("DELETE FROM metrics WHERE ts < ?", now - RETENTION_MS);
  await checkHostDisk();
}

async function checkHostDisk(): Promise<void> {
  const { totalBytes, freeBytes } = await hostDisk(config.SERVERS_DIR);
  const usedPct = ((totalBytes - freeBytes) / totalBytes) * 100;
  if (usedPct >= getSettings().diskAlertPercent) {
    void notify("host-disk", `💾 Диск VPS заполнен на ${usedPct.toFixed(0)}% (свободно ${(freeBytes / 1024 ** 3).toFixed(1)} ГБ).`, "disk");
  }
}

export function startMetricsCollector(): () => void {
  const timer = setInterval(() => void sampleAll().catch((e) => console.error("metrics:", e)), SAMPLE_EVERY_MS);
  return () => clearInterval(timer);
}

/** Downsampled history: at most ~300 points for any range. */
export function metricsHistory(serverId: string, rangeMs: number): MetricPoint[] {
  const since = Date.now() - rangeMs;
  const bucket = Math.max(SAMPLE_EVERY_MS, Math.floor(rangeMs / 300));
  return all<MetricPoint>(
    `SELECT (ts / ?) * ? AS ts, AVG(cpu) AS cpu, AVG(mem_mb) AS mem_mb, MAX(net_rx) AS net_rx, MAX(net_tx) AS net_tx,
            AVG(disk_mb) AS disk_mb, MAX(players) AS players, AVG(tps) AS tps
     FROM metrics WHERE server_id = ? AND ts >= ? GROUP BY ts / ? ORDER BY ts`,
    bucket,
    bucket,
    serverId,
    since,
    bucket,
  );
}
