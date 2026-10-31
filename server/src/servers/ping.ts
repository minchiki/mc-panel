import { containerIp, networkName } from "../docker/client.js";
import { rconExec } from "../lib/rcon.js";
import { RCON_PORT, usesServerProperties } from "./prepare.js";
import { listAllServers } from "./repo.js";
import { buildImage, containerLogsTail, containerName, docker, ensureImage, runOneShot } from "../docker/client.js";
import { parsePlayerAddress } from "./players.js";
import { getServer } from "./repo.js";
import { internalPort } from "./prepare.js";
import { runtime } from "./runtime.js";

const PROBE_IMAGE = "mcp-netprobe:1";
const PROBE_UID = 65534;
const CACHE_MS = 1500;

export type PingMap = Record<string, number | null>;

/** "[::ffff:1.2.3.4]:5" and "1.2.3.4:5" both become "1.2.3.4:5". */
function normalizeAddress(addr: string): string {
  const m = /^\[(.+)\]:(\d+)$/.exec(addr);
  if (!m) return addr;
  return `${m[1]!.replace(/^::ffff:/i, "")}:${m[2]}`;
}

/**
 * Parses `ss -H -tin` output: a connection line (`[ESTAB] rq sq local peer`) followed by an
 * indented line with `rtt:<smoothed>/<variance>`. Returns peer address -> smoothed RTT in ms.
 */
export function parseSsRtt(output: string): Map<string, number> {
  const result = new Map<string, number>();
  let peer: string | null = null;
  for (const line of output.split(/\r?\n/)) {
    const conn = /^(?:ESTAB\s+)?\d+\s+\d+\s+(\S+)\s+(\S+)\s*$/.exec(line);
    if (conn) {
      peer = normalizeAddress(conn[2]!);
      continue;
    }
    const rtt = peer ? /\brtt:([\d.]+)\// .exec(line) : null;
    if (peer && rtt) {
      result.set(peer, Math.round(Number(rtt[1])));
      peer = null;
    }
  }
  return result;
}

let imageReady: Promise<void> | null = null;

/** Tiny alpine image with iproute2's `ss`; built once, the game images don't ship it. */
function ensureProbeImage(): Promise<void> {
  imageReady ??= docker
    .getImage(PROBE_IMAGE)
    .inspect()
    .then(() => undefined)
    .catch(() => ensureImage("alpine:3.20").then(() => buildImage(PROBE_IMAGE, "FROM alpine:3.20\nRUN apk add --no-cache iproute2\n", () => undefined)))
    .catch((err) => {
      imageReady = null;
      throw err;
    });
  return imageReady;
}

async function readRtt(serverId: string, port: number): Promise<Map<string, number>> {
  await ensureProbeImage();
  const lines: string[] = [];
  const code = await runOneShot({
    image: PROBE_IMAGE,
    cmd: ["ss", "-H", "-t", "-i", "-n", "state", "established", "sport", "=", `:${port}`],
    binds: [],
    uid: PROBE_UID,
    gid: PROBE_UID,
    memoryMb: 32,
    workingDir: "/",
    networkMode: `container:${containerName(serverId)}`,
    onLine: (l) => lines.push(l),
  });
  if (code !== 0) throw new Error(`ss exited with ${code}`);
  return parseSsRtt(lines.join("\n"));
}

/** After a panel restart the login lines were missed; the container log still has them. */
async function recoverAddresses(serverId: string): Promise<void> {
  const rt = runtime(serverId);
  const log = await containerLogsTail(containerName(serverId), 5000).catch(() => "");
  for (const line of log.split(/\r?\n/)) {
    const login = parsePlayerAddress(line);
    if (login && rt.players.has(login.player)) rt.playerAddrs.set(login.player, login.address);
  }
}

const cache = new Map<string, { at: number; pings: Promise<PingMap> }>();

/** Ping per online player (null when the connection can't be matched, e.g. behind a proxy). */
export function playerPings(serverId: string): Promise<PingMap> {
  const hit = cache.get(serverId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.pings;
  const rt = runtime(serverId);
  const pings = (async (): Promise<PingMap> => {
    const players = [...rt.players];
    const empty = Object.fromEntries(players.map((p) => [p, null]));
    if (rt.status !== "online" || players.length === 0) return empty;
    if (players.some((p) => !rt.playerAddrs.has(p))) await recoverAddresses(serverId);
    const rtt = await readRtt(serverId, internalPort(getServer(serverId).core));
    return Object.fromEntries(players.map((p) => [p, rtt.get(rt.playerAddrs.get(p) ?? "") ?? null]));
  })();
  cache.set(serverId, { at: Date.now(), pings });
  pings.catch(() => cache.delete(serverId));
  return pings;
}

const OBJECTIVE = "ping";
const SYNC_EVERY_MS = 5000;

/**
 * Shows ping in the in-game Tab list: a dummy scoreboard objective in the `list` slot renders
 * its score next to every name, so vanilla clients need no mod. The score is the RTT in ms.
 */
async function syncServer(serverId: string, password: string): Promise<void> {
  const rt = runtime(serverId);
  if (rt.status !== "online" || rt.players.size === 0) return;
  const ip = await containerIp(containerName(serverId), networkName(serverId));
  if (!ip) return;
  const rcon = (cmd: string) => rconExec(ip, RCON_PORT, password, cmd);
  if (!rt.pingBoard) {
    await rcon(`scoreboard objectives add ${OBJECTIVE} dummy "ms"`); // "already exists" is fine
    await rcon(`scoreboard objectives setdisplay list ${OBJECTIVE}`);
    rt.pingBoard = true;
  }
  const pings = await playerPings(serverId);
  for (const [player, ms] of Object.entries(pings)) {
    if (ms !== null) await rcon(`scoreboard players set ${player} ${OBJECTIVE} ${ms}`);
  }
}

let syncing = false;

export function startPingSync(): () => void {
  const timer = setInterval(() => {
    if (syncing) return;
    syncing = true;
    void (async () => {
      for (const server of listAllServers()) {
        if (usesServerProperties(server.core)) await syncServer(server.id, server.rcon_password).catch(() => undefined);
      }
    })().finally(() => {
      syncing = false;
    });
  }, SYNC_EVERY_MS);
  return () => clearInterval(timer);
}
