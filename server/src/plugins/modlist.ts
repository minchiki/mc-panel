import { TarArchive, ZipArchive } from "archiver";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { config } from "../config.js";
import { one, run } from "../db/index.js";
import { CORE_INFO } from "../cores/types.js";
import { badRequest, conflict, errorMessage } from "../lib/errors.js";
import { downloadFile, fetchJson } from "../lib/http.js";
import { writeInside } from "../lib/safefs.js";
import { invalidateDisk } from "../servers/disk.js";
import { dataDirOf, type ServerRow } from "../servers/repo.js";
import { runtime } from "../servers/runtime.js";
import { addonsDir, safeJarName } from "./catalog.js";

/**
 * "Build from a list": the user types mod names, we resolve them on Modrinth
 * for the server's loader + MC version, pull required dependencies, install
 * what the server needs and zip what players need.
 */

type Side = "required" | "optional" | "unsupported" | "unknown";

export interface ModMatch {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  clientSide: Side;
  serverSide: Side;
}

export interface ResolveRow {
  query: string;
  match: ModMatch | null;
  alternatives: ModMatch[];
}

interface MrHit {
  project_id: string;
  slug: string;
  title: string;
  icon_url: string | null;
  client_side: Side;
  server_side: Side;
}
interface MrProject {
  id: string;
  slug: string;
  title: string;
  icon_url: string | null;
  client_side: Side;
  server_side: Side;
}
interface MrVersion {
  id: string;
  project_id: string;
  version_number: string;
  files: { url: string; filename: string; primary: boolean; hashes: { sha512?: string } }[];
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: "required" | "optional" | "incompatible" | "embedded" }[];
}

const MAX_MODS = 200;
const DOWNLOAD_CONCURRENCY = 4;
const API = "https://api.modrinth.com/v2";

const toMatch = (h: MrHit | MrProject): ModMatch => ({
  id: "project_id" in h ? h.project_id : h.id,
  slug: h.slug,
  title: h.title,
  icon: h.icon_url || null,
  clientSide: h.client_side,
  serverSide: h.server_side,
});

export function parseModList(text: string): string[] {
  const names = text
    .split(/[\n,;]+/)
    .map((s) => s.replace(/^[\s\-*•\d.)]+/, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 80);
  const seen = new Set<string>();
  return names.filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).slice(0, MAX_MODS);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9а-яё]/g, "");

function loaderFacets(server: ServerRow): string {
  const loaders = CORE_INFO[server.core].addons.modrinthLoaders;
  return JSON.stringify([loaders.map((l) => `categories:${l}`), [`versions:${server.mc_version}`], ["project_type:mod"]]);
}

/** Exact title/slug match wins; otherwise Modrinth's relevance order. */
async function resolveOne(server: ServerRow, query: string): Promise<ResolveRow> {
  const params = new URLSearchParams({ query, limit: "6", index: "relevance", facets: loaderFacets(server) });
  const data = await fetchJson<{ hits: MrHit[] }>(`${API}/search?${params}`);
  const hits = data.hits.map(toMatch);
  const q = norm(query);
  const exact = hits.find((h) => norm(h.title) === q || norm(h.slug) === q);
  const match = exact ?? hits[0] ?? null;
  return { query, match, alternatives: hits.filter((h) => h.id !== match?.id).slice(0, 4) };
}

export async function resolveModList(server: ServerRow, text: string): Promise<ResolveRow[]> {
  assertModded(server);
  const names = parseModList(text);
  if (names.length === 0) throw badRequest("Список пуст");
  const rows: ResolveRow[] = [];
  // Small batches: Modrinth allows ~300 req/min, and order must be kept.
  for (let i = 0; i < names.length; i += 5) {
    rows.push(...(await Promise.all(names.slice(i, i + 5).map((n) => resolveOne(server, n).catch(() => ({ query: n, match: null, alternatives: [] }))))));
  }
  return rows;
}

function assertModded(server: ServerRow): void {
  if (CORE_INFO[server.core].addons.dir !== "mods") throw badRequest("Сборка по списку работает для Forge, NeoForge и Fabric");
}

// ------------------------------------------------------------------ build job

export interface BuiltMod {
  title: string;
  file: string;
  version: string;
  onServer: boolean;
  onClient: boolean;
  dependencyOf: string | null;
}

export interface BuildJob {
  state: "running" | "done" | "failed";
  startedAt: number;
  log: string[];
  mods: BuiltMod[];
  problems: string[];
  zipName: string | null;
  error: string | null;
}

const jobs = new Map<string, BuildJob>();
export const getBuildJob = (serverId: string) => jobs.get(serverId) ?? null;

const clientPackDir = () => join(config.SERVERS_DIR, "..", "cache", "clientpacks");
export const clientZipPath = (serverId: string) => join(clientPackDir(), `${serverId}.zip`);

async function compatibleVersion(server: ServerRow, projectId: string): Promise<MrVersion | null> {
  const loaders = CORE_INFO[server.core].addons.modrinthLoaders;
  const params = new URLSearchParams({ loaders: JSON.stringify(loaders), game_versions: JSON.stringify([server.mc_version]) });
  const versions = await fetchJson<MrVersion[]>(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`);
  return versions[0] ?? null;
}

/** Breadth-first walk over required dependencies, deduplicated by project id. */
async function collect(server: ServerRow, rootIds: string[], job: BuildJob, titles: Map<string, string>) {
  const picked = new Map<string, { project: MrProject; version: MrVersion; dependencyOf: string | null }>();
  let queue = rootIds.map((id) => ({ id, parent: null as string | null }));
  const incompatible = new Map<string, string>();
  while (queue.length && picked.size < MAX_MODS) {
    const ids = [...new Set(queue.map((q) => q.id))].filter((id) => !picked.has(id));
    if (ids.length === 0) break;
    const projects = await fetchJson<MrProject[]>(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`);
    const next: typeof queue = [];
    for (const project of projects) {
      titles.set(project.id, project.title);
      const parent = queue.find((q) => q.id === project.id || q.id === project.slug)?.parent ?? null;
      const version = await compatibleVersion(server, project.id);
      if (!version) {
        job.problems.push(`«${project.title}» нет под ${server.core} ${server.mc_version}${parent ? ` (нужен для ${parent})` : ""}`);
        continue;
      }
      picked.set(project.id, { project, version, dependencyOf: parent });
      job.log.push(`✓ ${project.title} ${version.version_number}${parent ? `  ← зависимость ${parent}` : ""}`);
      for (const dep of version.dependencies) {
        if (!dep.project_id) continue;
        if (dep.dependency_type === "required" && !picked.has(dep.project_id)) next.push({ id: dep.project_id, parent: project.title });
        if (dep.dependency_type === "incompatible") incompatible.set(dep.project_id, project.title);
      }
    }
    queue = next;
  }
  for (const [id, by] of incompatible) {
    const other = picked.get(id);
    if (other) job.problems.push(`«${by}» несовместим с «${other.project.title}» — уберите один из них`);
  }
  return picked;
}

const needsServer = (s: Side) => s !== "unsupported";
const needsClient = (s: Side) => s !== "unsupported";

async function buildInBackground(server: ServerRow, projectIds: string[], job: BuildJob): Promise<void> {
  const rt = runtime(server.id);
  const work = join(clientPackDir(), `${server.id}-work`);
  await rm(work, { recursive: true, force: true });
  await mkdir(join(work, "mods"), { recursive: true });
  try {
    job.log.push("Ищу версии и зависимости…");
    const titles = new Map<string, string>();
    const picked = await collect(server, projectIds, job, titles);
    job.log.push(`Всего модов с зависимостями: ${picked.size}. Скачиваю…`);
    const modsDir = await addonsDir(server);
    const entries = [...picked.values()];
    for (let i = 0; i < entries.length; i += DOWNLOAD_CONCURRENCY) {
      await Promise.all(
        entries.slice(i, i + DOWNLOAD_CONCURRENCY).map(async ({ project, version, dependencyOf }) => {
          const file = version.files.find((f) => f.primary) ?? version.files[0];
          if (!file) return;
          const name = safeJarName(file.filename);
          const local = join(work, "mods", name);
          await downloadFile(file.url, local, { checksum: file.hashes.sha512 ? { algorithm: "sha512", hex: file.hashes.sha512 } : undefined });
          const onServer = needsServer(project.server_side);
          const onClient = needsClient(project.client_side);
          // Through a temp file + rename: a symlink planted at mods/<name> is replaced, not written through.
          if (onServer) await writeInside(dataDirOf(server.id), join(modsDir, name), createReadStream(local));
          if (!onClient) await rm(local, { force: true });
          job.mods.push({ title: project.title, file: name, version: version.version_number, onServer, onClient, dependencyOf });
        }),
      );
    }
    // Replace the previous preset's jars only now that every new download succeeded.
    const installed = job.mods.filter((m) => m.onServer).map((m) => m.file);
    const previous = getPreset(server.id)?.installedFiles ?? [];
    for (const old of previous.filter((f) => !installed.includes(f))) await rm(join(modsDir, safeJarName(old)), { force: true });
    // Keep every requested mod in the preset, even ones missing for this version,
    // so switching back to a version that has them restores them.
    const knownTitles = new Map((getPreset(server.id)?.mods ?? []).map((m) => [m.id, m.title]));
    for (const [id, title] of titles) knownTitles.set(id, title);
    savePreset(server.id, {
      mods: projectIds.map((id) => ({ id, title: knownTitles.get(id) ?? id })),
      installedFiles: installed,
    });
    job.log.push("Упаковываю моды для игроков…");
    await writeClientZip(server, work, job);
    invalidateDisk(server.id);
    job.state = "done";
    job.log.push(`Готово: на сервер ${job.mods.filter((m) => m.onServer).length}, игрокам ${job.mods.filter((m) => m.onClient).length}.`);
    rt.panel(`Сборка по списку: установлено ${job.mods.filter((m) => m.onServer).length} модов, перезапустите сервер`);
  } catch (err) {
    job.state = "failed";
    job.error = errorMessage(err);
    job.log.push(`Ошибка: ${job.error}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function writeClientZip(server: ServerRow, work: string, job: BuildJob): Promise<void> {
  const zipPath = clientZipPath(server.id);
  const tmp = `${zipPath}.part`;
  await rm(tmp, { force: true });
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const done = pipeline(archive, createWriteStream(tmp, { flags: "wx" }));
  for (const f of await readdir(join(work, "mods"))) archive.file(join(work, "mods", f), { name: `mods/${f}` });
  const loader = CORE_INFO[server.core].name;
  archive.append(
    [
      `Моды для сервера «${server.name}»`,
      `Нужен: Minecraft ${server.mc_version} + ${loader}${server.core_build ? ` ${server.core_build}` : ""}`,
      "",
      "Как установить:",
      `1. Установите ${loader} для ${server.mc_version} (или создайте сборку в Prism Launcher / CurseForge / Modrinth App).`,
      "2. Скопируйте содержимое папки mods из этого архива в папку mods игры.",
      "3. Запустите игру и подключитесь к серверу.",
      "",
      "Состав:",
      ...job.mods.filter((m) => m.onClient).map((m) => `- ${m.title} ${m.version}`),
    ].join("\r\n"),
    { name: "Как установить.txt" },
  );
  await archive.finalize();
  await done;
  await rm(zipPath, { force: true });
  await rename(tmp, zipPath);
  job.zipName = `${server.name.replace(/[^\wа-яё.-]+/gi, "_")}-mods-${server.mc_version}.zip`;
}

/** Starts a build and resolves when it finishes (the HTTP route doesn't await it). */
export function runBuild(server: ServerRow, projectIds: string[]): Promise<BuildJob> {
  assertModded(server);
  const ids = [...new Set(projectIds)].slice(0, MAX_MODS);
  if (ids.length === 0) throw badRequest("Не выбрано ни одного мода");
  if (getBuildJob(server.id)?.state === "running") throw conflict("Сборка уже идёт");
  const job: BuildJob = { state: "running", startedAt: Date.now(), log: [], mods: [], problems: [], zipName: null, error: null };
  jobs.set(server.id, job);
  return mkdir(clientPackDir(), { recursive: true })
    .then(() => buildInBackground(server, ids, job))
    .then(() => job);
}

// ------------------------------------------------------------------ presets

export interface Preset {
  mods: { id: string; title: string }[];
  installedFiles: string[];
  autoUpdate: boolean;
  updatedAt: number;
}

export function getPreset(serverId: string): Preset | null {
  const row = one<{ mods: string; installed_files: string; auto_update: number; updated_at: number }>(
    "SELECT * FROM mod_presets WHERE server_id = ?",
    serverId,
  );
  if (!row) return null;
  return {
    mods: JSON.parse(row.mods) as Preset["mods"],
    installedFiles: JSON.parse(row.installed_files) as string[],
    autoUpdate: row.auto_update === 1,
    updatedAt: row.updated_at,
  };
}

function savePreset(serverId: string, p: { mods: Preset["mods"]; installedFiles: string[] }): void {
  run(
    `INSERT INTO mod_presets (server_id, mods, installed_files, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(server_id) DO UPDATE SET mods = excluded.mods, installed_files = excluded.installed_files, updated_at = excluded.updated_at`,
    serverId,
    JSON.stringify(p.mods),
    JSON.stringify(p.installedFiles),
    Date.now(),
  );
}

/** Forget the preset and the client zip, e.g. after the mods folder was wiped. */
export async function clearPreset(serverId: string): Promise<void> {
  if (getBuildJob(serverId)?.state === "running") throw conflict("Сейчас идёт сборка модов, дождитесь её окончания");
  run("DELETE FROM mod_presets WHERE server_id = ?", serverId);
  jobs.delete(serverId);
  await rm(clientZipPath(serverId), { force: true });
}

export function setPresetAutoUpdate(serverId: string, enabled: boolean): void {
  run("UPDATE mod_presets SET auto_update = ? WHERE server_id = ?", enabled ? 1 : 0, serverId);
}

/**
 * After the core/version changed: fetch every preset mod again for the new
 * version (with dependencies) and swap the old jars out. Mods that don't exist
 * for the new version are reported in the job's problems.
 */
export async function rebuildPresetForNewVersion(server: ServerRow): Promise<void> {
  const preset = getPreset(server.id);
  if (!preset?.autoUpdate || preset.mods.length === 0 || CORE_INFO[server.core].addons.dir !== "mods") return;
  const rt = runtime(server.id);
  rt.panel(`Пресет модов: подбираю ${preset.mods.length} модов под ${server.core} ${server.mc_version}…`);
  const job = await runBuild(server, preset.mods.map((m) => m.id));
  for (const p of job.problems) rt.panel(`Пресет модов: ${p}`);
  if (job.state === "failed") rt.panel(`Пресет модов: ошибка — ${job.error}`);
}

export async function clientZipInfo(serverId: string): Promise<{ size: number; mtime: number } | null> {
  const st = await stat(clientZipPath(serverId)).catch(() => null);
  return st ? { size: st.size, mtime: st.mtimeMs } : null;
}
