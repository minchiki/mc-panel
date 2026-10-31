import { fetchJson } from "../lib/http.js";
import { mojangVersion } from "./versions.js";
import { JAVA_VERSIONS, type Core } from "./types.js";

/** Smallest installed Java that satisfies `required` (Mojang lists e.g. 16, we ship 17). */
export function pickJava(required: number): number {
  return JAVA_VERSIONS.find((v) => v >= required) ?? JAVA_VERSIONS[JAVA_VERSIONS.length - 1]!;
}

/** Fallback when Mojang metadata is unavailable (proxies, offline, unknown ids). */
export function guessJava(mcVersion: string): number {
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(mcVersion);
  if (!m) return 25; // 26.x and later year-based versions
  const minor = Number(m[1]);
  const patch = Number(m[2] ?? 0);
  if (minor <= 16) return 8;
  if (minor < 20 || (minor === 20 && patch <= 4)) return 17;
  return 21;
}

/** PaperMC Fill publishes the minimum Java per version (Velocity 4.3 needs 25, for example). */
async function paperMinimumJava(project: "paper" | "velocity", version: string): Promise<number | null> {
  const data = await fetchJson<{ version?: { java?: { version?: { minimum?: number } } } }>(
    `https://fill.papermc.io/v3/projects/${project}/versions/${encodeURIComponent(version)}`,
  );
  return data.version?.java?.version?.minimum ?? null;
}

export async function recommendJava(core: Core, mcVersion: string): Promise<number> {
  try {
    if (core === "paper" || core === "velocity") {
      const min = await paperMinimumJava(core, mcVersion);
      if (min) return pickJava(min);
    }
    if (core === "velocity" || core === "bungeecord") return 21;
    const meta = await mojangVersion(mcVersion);
    if (meta.javaVersion?.majorVersion) return pickJava(meta.javaVersion.majorVersion);
  } catch {
    // fall through to the heuristic
  }
  return core === "velocity" || core === "bungeecord" ? 21 : pickJava(guessJava(mcVersion));
}
