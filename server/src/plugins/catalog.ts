import { readdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { CORE_INFO, type Core } from "../cores/types.js";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors.js";
import { downloadFile, fetchJson, type Checksum } from "../lib/http.js";
import { assertFileName } from "../lib/paths.js";
import { mkdirInside } from "../lib/safefs.js";
import { getSettings } from "../lib/settings.js";
import { invalidateDisk } from "../servers/disk.js";
import { dataDirOf, type ServerRow } from "../servers/repo.js";

export const SOURCES = ["modrinth", "curseforge", "hangar", "spiget"] as const;
export type Source = (typeof SOURCES)[number];

export interface CatalogItem {
  source: Source;
  id: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  icon: string | null;
  url: string;
}

const PAGE_SIZE = 20;

// CurseForge ids: game 432 = Minecraft, class 6 = mods; modLoaderType enum from their API.
const CURSEFORGE_API = "https://api.curseforge.com/v1";
const CURSEFORGE_GAME_MINECRAFT = 432;
const CURSEFORGE_CLASS_MODS = 6;
const CURSEFORGE_SORT_POPULARITY = 2;
const CURSEFORGE_LOADERS: Partial<Record<Core, number>> = { forge: 1, fabric: 4, neoforge: 6 };
const CURSEFORGE_HASH_SHA1 = 1;

export function sourcesFor(core: Core): Source[] {
  const a = CORE_INFO[core].addons;
  const out: Source[] = [];
  if (a.modrinthLoaders.length) out.push("modrinth");
  if (CURSEFORGE_LOADERS[core]) out.push("curseforge");
  if (a.hangarPlatform) out.push("hangar");
  if (a.spiget) out.push("spiget");
  return out;
}

/** plugins/ or mods/, created if missing and verified not to be a symlink out of the server dir. */
export async function addonsDir(server: ServerRow): Promise<string> {
  const root = dataDirOf(server.id);
  return mkdirInside(root, join(root, CORE_INFO[server.core].addons.dir)).catch((err) => {
    throw err instanceof HttpError ? badRequest("Папка плагинов указывает за пределы сервера") : err;
  });
}

// ------------------------------------------------------------- search

async function searchModrinth(server: ServerRow, query: string, page: number): Promise<CatalogItem[]> {
  const a = CORE_INFO[server.core].addons;
  const facets = [
    a.modrinthLoaders.map((l) => `categories:${l}`),
    [`project_type:${a.dir === "mods" ? "mod" : "plugin"}`],
  ];
  if (server.core !== "velocity" && server.core !== "bungeecord") facets.push([`versions:${server.mc_version}`]);
  const params = new URLSearchParams({
    query,
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
    index: query ? "relevance" : "downloads",
    facets: JSON.stringify(facets),
  });
  const data = await fetchJson<{
    hits: { project_id: string; slug: string; title: string; description: string; author: string; downloads: number; icon_url: string | null }[];
  }>(`https://api.modrinth.com/v2/search?${params}`);
  return data.hits.map((h) => ({
    source: "modrinth",
    id: h.project_id,
    title: h.title,
    description: h.description,
    author: h.author,
    downloads: h.downloads,
    icon: h.icon_url || null,
    url: `https://modrinth.com/project/${h.slug}`,
  }));
}

/** CurseForge requires a personal API key (console.curseforge.com), stored in the panel settings. */
function curseforgeHeaders(): Record<string, string> {
  const key = getSettings().curseforgeApiKey;
  if (!key) throw conflict("Для CurseForge нужен API-ключ: администратор добавляет его в «Администрирование» → «Настройки панели»");
  return { "x-api-key": key };
}

async function searchCurseforge(server: ServerRow, query: string, page: number): Promise<CatalogItem[]> {
  const headers = curseforgeHeaders();
  const params = new URLSearchParams({
    gameId: String(CURSEFORGE_GAME_MINECRAFT),
    classId: String(CURSEFORGE_CLASS_MODS),
    gameVersion: server.mc_version,
    modLoaderType: String(CURSEFORGE_LOADERS[server.core]),
    searchFilter: query,
    sortField: String(CURSEFORGE_SORT_POPULARITY),
    sortOrder: "desc",
    pageSize: String(PAGE_SIZE),
    index: String(page * PAGE_SIZE),
  });
  const data = await fetchJson<{
    data: { id: number; name: string; summary: string; downloadCount: number; authors: { name: string }[]; logo: { thumbnailUrl: string } | null; links: { websiteUrl: string } }[];
  }>(`${CURSEFORGE_API}/mods/search?${params}`, undefined, headers);
  return data.data.map((m) => ({
    source: "curseforge",
    id: String(m.id),
    title: m.name,
    description: m.summary ?? "",
    author: m.authors[0]?.name ?? "",
    downloads: m.downloadCount,
    icon: m.logo?.thumbnailUrl || null,
    url: m.links.websiteUrl,
  }));
}

async function searchHangar(server: ServerRow, query: string, page: number): Promise<CatalogItem[]> {
  const platform = CORE_INFO[server.core].addons.hangarPlatform!;
  const params = new URLSearchParams({ q: query, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), platform });
  if (platform === "PAPER") params.set("version", server.mc_version);
  const data = await fetchJson<{
    result: { name: string; namespace: { owner: string; slug: string }; description: string; stats: { downloads: number }; avatarUrl: string }[];
  }>(`https://hangar.papermc.io/api/v1/projects?${params}`);
  return data.result.map((p) => ({
    source: "hangar",
    id: p.namespace.slug,
    title: p.name,
    description: p.description ?? "",
    author: p.namespace.owner,
    downloads: p.stats.downloads,
    icon: p.avatarUrl || null,
    url: `https://hangar.papermc.io/${p.namespace.owner}/${p.namespace.slug}`,
  }));
}

async function searchSpiget(query: string, page: number): Promise<CatalogItem[]> {
  const fields = "id,name,tag,downloads,external,icon,author";
  const base = query
    ? `https://api.spiget.org/v2/search/resources/${encodeURIComponent(query)}`
    : "https://api.spiget.org/v2/resources/free";
  const data = await fetchJson<
    { id: number; name: string; tag: string; downloads: number; external: boolean; icon?: { url?: string }; author?: { id: number } }[]
  >(`${base}?size=${PAGE_SIZE}&page=${page + 1}&sort=-downloads&fields=${fields}`);
  return data
    .filter((r) => !r.external)
    .map((r) => ({
      source: "spiget",
      id: String(r.id),
      title: r.name,
      description: r.tag ?? "",
      author: r.author ? `#${r.author.id}` : "",
      downloads: r.downloads,
      icon: r.icon?.url ? `https://www.spigotmc.org/${r.icon.url}` : null,
      url: `https://www.spigotmc.org/resources/${r.id}/`,
    }));
}

export async function searchCatalog(server: ServerRow, source: Source, query: string, page: number): Promise<CatalogItem[]> {
  if (!sourcesFor(server.core).includes(source)) throw badRequest("Этот источник не подходит для ядра сервера");
  if (source === "modrinth") return searchModrinth(server, query, page);
  if (source === "curseforge") return searchCurseforge(server, query, page);
  if (source === "hangar") return searchHangar(server, query, page);
  return searchSpiget(query, page);
}

// ------------------------------------------------------------- install

type Resolved = { url: string; filename: string; checksum?: Checksum };

async function resolveModrinth(server: ServerRow, projectId: string): Promise<Resolved> {
  const loaders = CORE_INFO[server.core].addons.modrinthLoaders;
  const params = new URLSearchParams({ loaders: JSON.stringify(loaders) });
  if (server.core !== "velocity" && server.core !== "bungeecord") params.set("game_versions", JSON.stringify([server.mc_version]));
  const versions = await fetchJson<{ files: { url: string; filename: string; primary: boolean; hashes: { sha512?: string } }[] }[]>(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version?${params}`,
  );
  const file = versions[0]?.files.find((f) => f.primary) ?? versions[0]?.files[0];
  if (!file) throw notFound(`Совместимая версия для ${server.mc_version}`, "f");
  return { url: file.url, filename: file.filename, checksum: file.hashes.sha512 ? { algorithm: "sha512", hex: file.hashes.sha512 } : undefined };
}

async function resolveCurseforge(server: ServerRow, modId: string): Promise<Resolved> {
  if (!/^\d+$/.test(modId)) throw badRequest("Неверный id мода");
  const headers = curseforgeHeaders();
  const params = new URLSearchParams({ gameVersion: server.mc_version, modLoaderType: String(CURSEFORGE_LOADERS[server.core]), pageSize: "1" });
  const files = await fetchJson<{ data: { fileName: string; downloadUrl: string | null; hashes: { value: string; algo: number }[] }[] }>(
    `${CURSEFORGE_API}/mods/${modId}/files?${params}`,
    undefined,
    headers,
  );
  const file = files.data[0];
  if (!file) throw notFound(`Совместимая версия для ${server.mc_version}`, "f");
  // Authors can forbid third-party downloads; the API then returns no URL and we respect that.
  if (!file.downloadUrl) throw conflict("Автор запретил скачивание этого мода сторонними программами. Скачайте jar на CurseForge и загрузите вручную.");
  const sha1 = file.hashes.find((h) => h.algo === CURSEFORGE_HASH_SHA1)?.value;
  return { url: file.downloadUrl, filename: file.fileName, checksum: sha1 ? { algorithm: "sha1", hex: sha1 } : undefined };
}

async function resolveHangar(server: ServerRow, slug: string): Promise<Resolved> {
  const platform = CORE_INFO[server.core].addons.hangarPlatform!;
  const params = new URLSearchParams({ limit: "1", offset: "0", platform });
  if (platform === "PAPER") params.set("platformVersion", server.mc_version);
  const data = await fetchJson<{
    result: { name: string; downloads: Record<string, { downloadUrl: string | null; externalUrl: string | null; fileInfo: { name: string } | null }> }[];
  }>(`https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(slug)}/versions?${params}`);
  const version = data.result[0];
  const dl = version?.downloads[platform];
  if (!version || !dl) throw notFound(`Совместимая версия для ${server.mc_version}`, "f");
  if (!dl.downloadUrl) {
    throw conflict(`Автор публикует этот плагин только по внешней ссылке: ${dl.externalUrl ?? "нет ссылки"}. Скачайте jar и загрузите его вручную.`);
  }
  return { url: dl.downloadUrl, filename: dl.fileInfo?.name ?? `${slug}-${version.name}.jar` };
}

async function resolveSpiget(id: string): Promise<Resolved> {
  if (!/^\d+$/.test(id)) throw badRequest("Неверный id ресурса");
  const info = await fetchJson<{ name: string; external: boolean; version?: { id: number } }>(`https://api.spiget.org/v2/resources/${id}`);
  if (info.external) throw conflict("Этот плагин размещён на внешнем сайте, установите его вручную");
  return { url: `https://api.spiget.org/v2/resources/${id}/download`, filename: `${info.name.replace(/[^\w.-]+/g, "_")}.jar` };
}

export async function installFromCatalog(server: ServerRow, source: Source, id: string): Promise<string> {
  if (!sourcesFor(server.core).includes(source)) throw badRequest("Этот источник не подходит для ядра сервера");
  const target =
    source === "modrinth"
      ? await resolveModrinth(server, id)
      : source === "curseforge"
        ? await resolveCurseforge(server, id)
        : source === "hangar"
          ? await resolveHangar(server, id)
          : await resolveSpiget(id);
  const filename = safeJarName(target.filename);
  const dir = await addonsDir(server);
  try {
    await downloadFile(target.url, join(dir, filename), { checksum: target.checksum, insideRoot: dataDirOf(server.id) });
  } catch (err) {
    if (source === "spiget") {
      throw conflict(`SpigotMC не отдал файл автоматически (защита сайта). Скачайте плагин вручную со страницы ресурса и загрузите jar. (${(err as Error).message})`);
    }
    throw err;
  }
  invalidateDisk(server.id);
  return filename;
}

// ------------------------------------------------------------- installed

export interface InstalledAddon {
  file: string;
  name: string;
  enabled: boolean;
  sizeBytes: number;
  modifiedAt: number;
}

export async function listInstalled(server: ServerRow): Promise<InstalledAddon[]> {
  const dir = await addonsDir(server);
  const files = await readdir(dir).catch(() => [] as string[]);
  const out: InstalledAddon[] = [];
  for (const file of files) {
    if (!file.endsWith(".jar") && !file.endsWith(".jar.disabled")) continue;
    const st = await stat(join(dir, file));
    if (!st.isFile()) continue;
    out.push({ file, name: file.replace(/\.disabled$/, "").replace(/\.jar$/, ""), enabled: file.endsWith(".jar"), sizeBytes: st.size, modifiedAt: st.mtimeMs });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function setAddonEnabled(server: ServerRow, file: string, enabled: boolean): Promise<void> {
  assertFileName(file);
  const dir = await addonsDir(server);
  const base = file.replace(/\.disabled$/, "");
  if (!base.endsWith(".jar")) throw badRequest("Это не jar-файл");
  const from = join(dir, enabled ? `${base}.disabled` : base);
  const to = join(dir, enabled ? base : `${base}.disabled`);
  await rename(from, to).catch(() => {
    throw notFound("Файл");
  });
}

export async function deleteAddon(server: ServerRow, file: string): Promise<void> {
  assertFileName(file);
  if (!file.endsWith(".jar") && !file.endsWith(".jar.disabled")) throw badRequest("Это не jar-файл");
  await rm(join(await addonsDir(server), file), { force: true });
  invalidateDisk(server.id);
}

export function safeJarName(name: string): string {
  const clean = basename(name).replace(/[^\w.+-]+/g, "_");
  const withExt = clean.toLowerCase().endsWith(".jar") ? clean : `${clean}.jar`;
  assertFileName(withExt);
  return withExt;
}
