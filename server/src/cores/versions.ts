import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { cached, fetchJson, fetchText } from "../lib/http.js";
import type { Core, VersionEntry } from "./types.js";

const TEN_MIN = 10 * 60_000;

interface MojangManifest {
  latest: { release: string; snapshot: string };
  versions: { id: string; type: string; url: string }[];
}
interface MojangVersion {
  javaVersion?: { majorVersion: number };
  downloads: { server?: { url: string; sha1: string } };
}

export const mojangManifest = cached(TEN_MIN, () =>
  fetchJson<MojangManifest>("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"),
);

export const mojangVersion = cached(TEN_MIN * 6, async (id) => {
  const manifest = await mojangManifest("");
  const entry = manifest.versions.find((v) => v.id === id);
  if (!entry) throw new Error(`Версия ${id} не найдена у Mojang`);
  return fetchJson<MojangVersion>(entry.url);
});

const isRelease = (id: string) => /^\d+(\.\d+)+$/.test(id);

async function paperFamily(project: "paper" | "velocity"): Promise<VersionEntry[]> {
  const data = await fetchJson<{ versions: Record<string, string[]> }>(`https://fill.papermc.io/v3/projects/${project}`);
  return Object.values(data.versions)
    .flat()
    .map((id) => ({ id, stable: !/(rc|pre|snapshot|beta|alpha)/i.test(id) }));
}

async function purpur(): Promise<VersionEntry[]> {
  const data = await fetchJson<{ versions: string[] }>("https://api.purpurmc.org/v2/purpur");
  return [...data.versions].reverse().map((id) => ({ id, stable: true }));
}

async function vanilla(): Promise<VersionEntry[]> {
  const m = await mojangManifest("");
  return m.versions.filter((v) => v.type === "release" || v.type === "snapshot").map((v) => ({ id: v.id, stable: v.type === "release" }));
}

async function fabric(): Promise<VersionEntry[]> {
  const games = await fetchJson<{ version: string; stable: boolean }[]>("https://meta.fabricmc.net/v2/versions/game");
  return games.map((g) => ({ id: g.version, stable: g.stable }));
}

async function forge(): Promise<VersionEntry[]> {
  const data = await fetchJson<{ promos: Record<string, string> }>(
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
  );
  const byMc = new Map<string, { recommended?: string; latest?: string }>();
  for (const [key, build] of Object.entries(data.promos)) {
    const m = /^(.+)-(recommended|latest)$/.exec(key);
    if (!m) continue;
    const entry = byMc.get(m[1]!) ?? {};
    entry[m[2] as "recommended" | "latest"] = build;
    byMc.set(m[1]!, entry);
  }
  return [...byMc.entries()]
    .map(([id, b]) => ({ id, build: b.recommended ?? b.latest, stable: Boolean(b.recommended) }))
    .sort((a, b) => compareVersions(b.id, a.id));
}

/** NeoForge "21.1.77" → MC "1.21.1"; "26.3.0.94" → "26.3"; "26.1.2.5" → "26.1.2". */
export function neoforgeToMc(v: string): string | null {
  const parts = v.split(/[.-]/);
  const major = Number(parts[0]);
  if (!Number.isFinite(major)) return null;
  if (major >= 26) {
    const [a, b, c] = parts;
    return c && c !== "0" ? `${a}.${b}.${c}` : `${a}.${b}`;
  }
  return parts[1] === "0" ? `1.${parts[0]}` : `1.${parts[0]}.${parts[1]}`;
}

async function neoforge(): Promise<VersionEntry[]> {
  const data = await fetchJson<{ versions: string[] }>(
    "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
  );
  const latest = new Map<string, string>();
  for (const v of data.versions) {
    if (/beta|alpha/i.test(v)) continue;
    const mc = neoforgeToMc(v);
    if (mc) latest.set(mc, v); // list is ascending, so the last one wins
  }
  return [...latest.entries()].map(([id, build]) => ({ id, build, stable: true })).sort((a, b) => compareVersions(b.id, a.id));
}

async function spigot(): Promise<VersionEntry[]> {
  const html = await fetchText("https://hub.spigotmc.org/versions/");
  const ids = [...html.matchAll(/href="([0-9][0-9.]*)\.json"/g)].map((m) => m[1]!).filter(isRelease);
  return [...new Set(ids)].sort((a, b) => compareVersions(b, a)).map((id) => ({ id, stable: true }));
}

const loaders: Record<Core, () => Promise<VersionEntry[]>> = {
  vanilla,
  paper: () => paperFamily("paper"),
  purpur,
  spigot,
  fabric,
  forge,
  neoforge,
  velocity: () => paperFamily("velocity"),
  bungeecord: async () => [{ id: "latest", stable: true }],
};

/**
 * Version lists survive upstream outages: every successful fetch is mirrored to
 * disk, and when the upstream is unreachable the last known list is served.
 */
async function loadWithDiskFallback(core: string): Promise<VersionEntry[]> {
  const file = join(config.DATA_DIR, "cache", `versions-${core}.json`);
  try {
    const list = await loaders[core as Core]();
    await mkdir(join(config.DATA_DIR, "cache"), { recursive: true });
    await writeFile(file, JSON.stringify(list)).catch(() => undefined);
    return list;
  } catch (err) {
    try {
      const stale = JSON.parse(await readFile(file, "utf8")) as VersionEntry[];
      if (stale.length > 0) return stale;
    } catch {
      /* no cache yet */
    }
    throw err;
  }
}

export const listVersions = cached(TEN_MIN, loadWithDiskFallback);

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => (Number.isNaN(Number(x)) ? -1 : Number(x)));
  const pb = b.split(/[.-]/).map((x) => (Number.isNaN(Number(x)) ? -1 : Number(x)));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
