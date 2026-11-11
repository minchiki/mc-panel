import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { CORE_INFO, type Core } from "../cores/types.js";
import { writeNoFollow } from "../lib/paths.js";
import { mkdirInside, readInside, writeInside } from "../lib/safefs.js";
import { applyUpdates, parseProperties, serializeProperties } from "../lib/properties.js";
import { dataDirOf, type ServerRow } from "./repo.js";

export const RCON_PORT = 25575;

/** Port the software listens on inside the container; the host port maps onto it. */
export function internalPort(core: Core): number {
  return CORE_INFO[core].kind === "proxy" ? 25577 : 25565;
}

export function usesServerProperties(core: Core): boolean {
  return CORE_INFO[core].kind === "server";
}

export function stopCommand(core: Core): string {
  if (core === "velocity") return "shutdown";
  if (core === "bungeecord") return "end";
  return "stop";
}

/** Log line that means "ready for players". */
export function isReadyLine(core: Core, line: string): boolean {
  if (core === "bungeecord") return /Listening on /.test(line);
  return /Done \([\d.,]+m?s\)!/.test(line);
}

const AIKAR_FLAGS =
  "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC " +
  "-XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 " +
  "-XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 " +
  "-XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1";

export function defaultJvmFlags(core: Core): string {
  return CORE_INFO[core].kind === "proxy" ? "-XX:+UseG1GC -XX:G1HeapRegionSize=4M" : AIKAR_FLAGS;
}

/**
 * Heap leaves room for metaspace, code cache, threads and direct buffers inside
 * the container limit; with less headroom a busy server gets OOM-killed.
 */
export function heapMb(ramMb: number): number {
  return Math.max(256, ramMb - Math.max(768, Math.round(ramMb * 0.2)));
}

/** Our own RCON polling makes the server log connect/disconnect lines; keep them out of the console. */
export function isNoiseLine(line: string): boolean {
  return /Thread RCON Client \/[\d.]+ (started|shutting down)/.test(line);
}

/**
 * Game containers have no IPv6 route, but Mojang's auth hosts resolve to IPv6
 * first and Java does not fall back ("Network is unreachable" on key fetch).
 */
const PANEL_FLAGS = "-Djava.net.preferIPv4Stack=true";

export function buildCommand(server: ServerRow): string {
  const heap = heapMb(server.ram_mb);
  return server.startup
    .replace("{{XMS}}", `-Xms${heap}M`)
    .replace("{{XMX}}", `-Xmx${heap}M`)
    .replace("{{FLAGS}}", `${PANEL_FLAGS} ${server.jvm_flags}`)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Before every start: accept EULA (the owner accepted it in the wizard), pin the
 * listen port and enable RCON with the panel's password. Missing keys in
 * server.properties are filled with defaults by the game on first boot.
 */
export async function prepareFiles(server: ServerRow): Promise<void> {
  const dir = dataDirOf(server.id);
  if (!usesServerProperties(server.core)) return;
  await writeNoFollow(join(dir, "eula.txt"), "# Accepted by the server owner in MC Panel\neula=true\n");
  const path = join(dir, "server.properties");
  const text = await readInside(dir, path).then((b) => b.toString("utf8"), () => "");
  const lines = parseProperties(text);
  const port = String(internalPort(server.core));
  const next = applyUpdates(lines, {
    "server-port": port,
    "query.port": port,
    "enable-rcon": "true",
    "rcon.port": String(RCON_PORT),
    "rcon.password": server.rcon_password,
    "broadcast-rcon-to-ops": "false",
  });
  await writeNoFollow(path, serializeProperties(next));
  await prepareVoiceChat(server);
}

/**
 * Simple Voice Chat listens on its own UDP port (24454 by default), which the
 * container does not publish. Point it at the game port instead: that UDP port
 * is already mapped host:server.port -> container:internalPort. The mod tells
 * clients its listen port, so when the host port differs we advertise the real
 * one through voice_host (keeping a host the owner set there).
 */
export function voiceChatUpdates(server: ServerRow, currentVoiceHost: string): Record<string, string> {
  const inner = internalPort(server.core);
  let voiceHost = "";
  if (server.port !== inner) {
    // A bare port makes clients reuse the address they joined with.
    const custom = currentVoiceHost.trim().replace(/:?\d+$/, "");
    voiceHost = custom ? `${custom}:${server.port}` : String(server.port);
  }
  return { port: String(inner), bind_address: "", voice_host: voiceHost };
}

async function prepareVoiceChat(server: ServerRow): Promise<void> {
  const root = dataDirOf(server.id);
  const addons = CORE_INFO[server.core].addons.dir;
  const jars = await readdir(join(root, addons)).catch(() => [] as string[]);
  if (!jars.some((f) => /voicechat/i.test(f) && f.endsWith(".jar"))) return;
  // The folder is game-writable: created and written without following planted symlinks.
  const dir = await mkdirInside(root, join(root, addons === "mods" ? "config" : "plugins", "voicechat")).catch(() => null);
  if (!dir) return;
  const path = join(dir, "voicechat-server.properties");
  const lines = parseProperties(await readInside(root, path).then((b) => b.toString("utf8"), () => ""));
  const entry = lines.find((l) => l.kind === "entry" && l.key === "voice_host");
  const current = entry?.kind === "entry" ? entry.value : "";
  await writeInside(root, path, serializeProperties(applyUpdates(lines, voiceChatUpdates(server, current))));
}

/** First-time defaults written once at creation (the user can change them later). */
export async function writeInitialProperties(server: ServerRow, motd: string): Promise<void> {
  if (!usesServerProperties(server.core)) return;
  const lines = applyUpdates([], { motd, "max-players": "20", "online-mode": "true", difficulty: "normal" });
  await writeNoFollow(join(dataDirOf(server.id), "server.properties"), serializeProperties(lines));
}
