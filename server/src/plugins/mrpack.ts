/**
 * Modrinth modpacks (.mrpack): inspect an uploaded or linked pack, then install its server side onto a server.
 * Format: https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack
 *
 * A pack is a zip with modrinth.index.json (files to download, each with sha512 and env flags) plus
 * overrides/ and server-overrides/ folders copied over the server. Client-only files are skipped.
 */
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { z } from "zod";
import { createBackup } from "../backups/service.js";
import { config } from "../config.js";
import { recommendJava } from "../cores/java.js";
import { CORE_INFO, type Core } from "../cores/types.js";
import { randomId } from "../lib/crypto.js";
import { badRequest, conflict, errorMessage, HttpError, notFound } from "../lib/errors.js";
import { downloadFile } from "../lib/http.js";
import { isWithin, resolveInside } from "../lib/paths.js";
import { invalidateDisk, serverDiskBytes } from "../servers/disk.js";
import { reinstallServer } from "../servers/lifecycle.js";
import { dataDirOf, getServer, type ServerRow } from "../servers/repo.js";
import { runtime, withServerStopped } from "../servers/runtime.js";
import { addonsDir, safeJarName } from "./catalog.js";
import { clearPreset, getBuildJob } from "./modlist.js";

// ------------------------------------------------------------- format

/** Hosts the Modrinth spec allows in "downloads". Anything else is refused. */
const ALLOWED_HOSTS = new Set(["cdn.modrinth.com", "github.com", "raw.githubusercontent.com", "gitlab.com"]);
/** Files a pack may never overwrite: the loader/core installation belongs to the panel. */
const PROTECTED = /^(server\.jar|eula\.txt|run\.(sh|bat)|user_jvm_args\.txt|libraries|versions|\.fabric|bundler|cache)(\/|$)/i;
/** Override folders useless on a server. */
const SKIP_ON_SERVER = /^(shaderpacks|resourcepacks|screenshots|saves|logs|crash-reports)(\/|$)|(^|\/)(desktop\.ini|thumbs\.db|\.ds_store)$/i;
const MAX_PACK_BYTES = 1024 * 1024 * 1024;

const indexSchema = z.object({
  formatVersion: z.literal(1, { error: "Неизвестная версия формата .mrpack" }),
  game: z.literal("minecraft", { error: "Это сборка не для Minecraft" }),
  versionId: z.string().max(200),
  name: z.string().max(200),
  summary: z.string().max(4000).optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        hashes: z.object({ sha512: z.string().regex(/^[0-9a-fA-F]{128}$/), sha1: z.string().optional() }),
        env: z.object({ client: z.string(), server: z.string() }).partial().optional(),
        downloads: z.array(z.string().max(2000)).min(1).max(20),
        fileSize: z.number().int().nonnegative(),
      }),
    )
    .max(5000),
  dependencies: z.record(z.string(), z.string()),
});
export type PackIndex = z.infer<typeof indexSchema>;
export type PackFile = PackIndex["files"][number];

export function parseIndex(text: string): PackIndex {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw badRequest("modrinth.index.json повреждён");
  }
  const res = indexSchema.safeParse(json);
  if (!res.success) throw badRequest(`Не похоже на сборку Modrinth: ${res.error.issues[0]?.message ?? "неверный формат"}`);
  return res.data;
}

/** Which core/version/loader build the pack needs. */
export function packTarget(index: PackIndex): { core: Core; mcVersion: string; build: string | null } {
  const d = index.dependencies;
  const mcVersion = d.minecraft;
  if (!mcVersion) throw badRequest("В сборке не указана версия Minecraft");
  if (d["fabric-loader"]) return { core: "fabric", mcVersion, build: d["fabric-loader"] };
  if (d.neoforge) return { core: "neoforge", mcVersion, build: d.neoforge };
  if (d.forge) return { core: "forge", mcVersion, build: d.forge };
  if (d["quilt-loader"]) throw badRequest("Сборки на Quilt панель пока не ставит: нужен Fabric, Forge или NeoForge");
  throw badRequest("В сборке не указан загрузчик модов (Fabric, Forge или NeoForge)");
}

/** Normalised relative path, or null when it is absolute, escapes upwards or touches the core install. */
export function safePackPath(raw: string): string | null {
  const p = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!p || p.startsWith("/") || /^[a-zA-Z]:/.test(p) || p.split("/").some((seg) => seg === ".." || seg === "")) return null;
  if (PROTECTED.test(p)) return null;
  return p;
}

export function allowedDownload(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export const isServerFile = (f: PackFile) => f.env?.server !== "unsupported";

// ------------------------------------------------------------- zip helpers

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, strictFileNames: false }, (err, z) => (err || !z ? reject(badRequest("Файл не является zip-архивом .mrpack")) : resolve(z))),
  );
}
function openBuffer(buf: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => yauzl.fromBuffer(buf, { lazyEntries: true }, (err, z) => (err || !z ? reject(err ?? new Error("zip")) : resolve(z))));
}
const entryStream = (zip: yauzl.ZipFile, e: yauzl.Entry) =>
  new Promise<Readable>((res, rej) => zip.openReadStream(e, (err, s) => (err || !s ? rej(err ?? new Error("zip stream")) : res(s))));
async function streamToBuffer(s: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of s) {
    n += (c as Buffer).length;
    if (n > limit) throw badRequest("Файл внутри архива слишком большой");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Walks every entry; `onEntry` returns false to stop early. */
async function eachEntry(zip: yauzl.ZipFile, onEntry: (e: yauzl.Entry) => Promise<boolean | void>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (e: yauzl.Entry) => {
      onEntry(e)
        .then((more) => (more === false ? (zip.close(), resolve()) : zip.readEntry()))
        .catch((err) => {
          zip.close();
          reject(err);
        });
    });
    zip.readEntry();
  });
}

async function readZipEntry(zip: yauzl.ZipFile, name: string, limit: number): Promise<Buffer | null> {
  let found: Buffer | null = null;
  await eachEntry(zip, async (e) => {
    if (e.fileName !== name) return true;
    found = await streamToBuffer(await entryStream(zip, e), limit);
    return false;
  });
  return found;
}

// ------------------------------------------------------------- uploaded packs

export interface PackInfo {
  id: string;
  name: string;
  version: string;
  summary: string;
  core: Core;
  mcVersion: string;
  build: string | null;
  java: number;
  serverFiles: number;
  clientOnlyFiles: number;
  downloadMb: number;
  overrideFiles: number;
}

const packDir = () => join(config.SERVERS_DIR, "..", "cache", "mrpacks");
const PACK_TTL_MS = 3 * 3600_000;
const owners = new Map<string, number>();

async function purgeOldPacks(): Promise<void> {
  const dir = packDir();
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    const s = await stat(join(dir, f)).catch(() => null);
    if (s && Date.now() - s.mtimeMs > PACK_TTL_MS) await rm(join(dir, f), { force: true });
  }
}

/** Reads the index and override count of a pack file on disk. */
export async function inspectFile(path: string): Promise<Omit<PackInfo, "id" | "java"> & { index: PackIndex }> {
  const indexBuf = await readZipEntry(await openZip(path), "modrinth.index.json", 20 * 1024 * 1024);
  if (!indexBuf) throw badRequest("В архиве нет modrinth.index.json: это не сборка Modrinth (.mrpack)");
  const index = parseIndex(indexBuf.toString("utf8"));
  const target = packTarget(index);
  let overrideFiles = 0;
  await eachEntry(await openZip(path), async (e) => {
    if (/^(overrides|server-overrides)\/.+[^/]$/.test(e.fileName)) overrideFiles++;
  });
  const server = index.files.filter(isServerFile);
  return {
    index,
    name: index.name,
    version: index.versionId,
    summary: index.summary ?? "",
    ...target,
    serverFiles: server.length,
    clientOnlyFiles: index.files.length - server.length,
    downloadMb: Math.round(server.reduce((a, f) => a + f.fileSize, 0) / 1048576),
    overrideFiles,
  };
}

async function registerPack(tmp: string, userId: number): Promise<PackInfo> {
  try {
    const info = await inspectFile(tmp);
    const id = randomId(12);
    await rename(tmp, join(packDir(), `${id}.mrpack`));
    owners.set(id, userId);
    const { index: _index, ...rest } = info;
    return { id, java: await recommendJava(info.core, info.mcVersion), ...rest };
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Saves an uploaded .mrpack and returns what it contains. */
export async function savePackUpload(data: Readable, fileName: string, userId: number): Promise<PackInfo> {
  if (!/\.mrpack$/i.test(fileName)) throw badRequest("Нужен файл сборки с расширением .mrpack");
  await mkdir(packDir(), { recursive: true });
  await purgeOldPacks();
  const tmp = join(packDir(), `upload-${randomId(10)}.part`);
  await pipeline(data, createWriteStream(tmp, { flags: "wx" }));
  if ((await stat(tmp)).size > MAX_PACK_BYTES) {
    await rm(tmp, { force: true });
    throw badRequest("Сборка больше 1 ГБ");
  }
  return registerPack(tmp, userId);
}

/** Downloads a .mrpack from Modrinth's CDN (a link copied from the modpack's version page). */
export async function savePackFromUrl(url: string, userId: number): Promise<PackInfo> {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw badRequest("Неверная ссылка");
  }
  if (u.protocol !== "https:" || u.hostname !== "cdn.modrinth.com" || !u.pathname.endsWith(".mrpack")) {
    throw badRequest("Нужна прямая ссылка на файл .mrpack с cdn.modrinth.com (страница сборки → Versions → скачать)");
  }
  await mkdir(packDir(), { recursive: true });
  await purgeOldPacks();
  const tmp = join(packDir(), `url-${randomId(10)}.part`);
  try {
    await downloadFile(u.href, tmp);
  } catch (err) {
    await rm(tmp, { force: true });
    throw badRequest(`Не удалось скачать сборку: ${errorMessage(err)}`);
  }
  return registerPack(tmp, userId);
}

function packPath(packId: string, userId: number, isAdmin: boolean): string {
  if (!/^[a-z0-9]{12}$/.test(packId)) throw badRequest("Неверный id сборки");
  const owner = owners.get(packId);
  if (owner === undefined) throw notFound("Загруженная сборка (загрузите её ещё раз)");
  if (owner !== userId && !isAdmin) throw notFound("Загруженная сборка");
  return join(packDir(), `${packId}.mrpack`);
}

// ------------------------------------------------------------- fabric dependency check

interface FabricMod {
  ids: string[];
  depends: string[];
  clientOnly: boolean;
}
const BUILTIN_IDS = new Set(["minecraft", "java", "fabricloader", "fabric-loader", "mixinextras"]);

/** fabric.mod.json is "JSON" written by humans: tolerate raw newlines/tabs inside strings. */
export function parseFabricModJson(text: string): { id?: string; provides?: string[]; depends?: Record<string, unknown>; environment?: string; jars?: { file: string }[] } | null {
  for (const candidate of [text, text.replace(/[\r\n\t]+/g, " ")]) {
    try {
      return JSON.parse(candidate.replace(/^﻿/, ""));
    } catch {
      // try the next form
    }
  }
  return null;
}

async function readFabricMod(jar: Buffer, depth = 0): Promise<FabricMod | null> {
  let zip: yauzl.ZipFile;
  try {
    zip = await openBuffer(jar);
  } catch {
    return null;
  }
  let meta: ReturnType<typeof parseFabricModJson> = null;
  const nested: Buffer[] = [];
  const wanted = new Set<string>();
  await eachEntry(zip, async (e) => {
    if (e.fileName === "fabric.mod.json") {
      meta = parseFabricModJson((await streamToBuffer(await entryStream(zip, e), 2 * 1024 * 1024)).toString("utf8"));
      for (const j of meta?.jars ?? []) if (typeof j?.file === "string") wanted.add(j.file);
    } else if (depth < 2 && e.fileName.endsWith(".jar") && e.fileName.startsWith("META-INF/jars/")) {
      nested.push(await streamToBuffer(await entryStream(zip, e), 64 * 1024 * 1024));
    }
  });
  const m = meta as ReturnType<typeof parseFabricModJson>;
  if (!m?.id) return null;
  const ids = [m.id, ...(Array.isArray(m.provides) ? m.provides : [])];
  for (const n of nested) {
    const inner = await readFabricMod(n, depth + 1);
    if (inner) ids.push(...inner.ids);
  }
  return { ids, depends: Object.keys(m.depends ?? {}), clientOnly: m.environment === "client" };
}

/** Mod ids required by server-side mods but provided by nothing that is installed. */
export function missingDependencies(mods: FabricMod[]): Map<string, string[]> {
  const provided = new Set(BUILTIN_IDS);
  for (const m of mods) for (const id of m.ids) provided.add(id);
  const missing = new Map<string, string[]>();
  for (const m of mods) {
    if (m.clientOnly) continue;
    for (const dep of m.depends) {
      if (provided.has(dep) || dep.startsWith("fabric-") || dep === "fabric") continue;
      missing.set(dep, [...(missing.get(dep) ?? []), m.ids[0]!]);
    }
  }
  return missing;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// ------------------------------------------------------------- install job

export interface PackJob {
  state: "running" | "done" | "failed";
  pack: string;
  startedAt: number;
  done: number;
  total: number;
  log: string[];
  error: string | null;
}
const packJobs = new Map<string, PackJob>();
export const getPackJob = (serverId: string) => packJobs.get(serverId) ?? null;

export interface InstalledPack {
  name: string;
  version: string;
  core: Core;
  mcVersion: string;
  installedAt: number;
  files: string[];
}
const markerPath = (serverId: string) => join(dataDirOf(serverId), ".mrpack.json");
export async function installedPack(serverId: string): Promise<InstalledPack | null> {
  try {
    return JSON.parse(await readFile(markerPath(serverId), "utf8")) as InstalledPack;
  } catch {
    return null;
  }
}
/** The original .mrpack, kept for players (outside the server folder, so it doesn't eat its disk quota). */
export const playerPackPath = (serverId: string) => join(packDir(), "..", "clientpacks", `${serverId}.mrpack`);

export interface InstallOptions {
  backupFirst: boolean;
  /** Move the mods currently on the server to mods.old-<date> first. */
  clearMods: boolean;
}

export async function startPackInstall(server: ServerRow, packId: string, user: { id: number; role: string }, opts: InstallOptions): Promise<PackJob> {
  const path = packPath(packId, user.id, user.role === "admin");
  if (CORE_INFO[server.core].kind !== "server") throw conflict("Сборку модов нельзя поставить на прокси (Velocity/BungeeCord)");
  if (getPackJob(server.id)?.state === "running") throw conflict("Сборка уже устанавливается");
  if (getBuildJob(server.id)?.state === "running") throw conflict("Сейчас идёт «Сборка по списку», дождитесь её окончания");
  const info = await inspectFile(path);
  const job: PackJob = { state: "running", pack: `${info.name} ${info.version}`, startedAt: Date.now(), done: 0, total: info.serverFiles, log: [], error: null };
  packJobs.set(server.id, job);
  void runInstall(server.id, path, info.index, opts, job);
  return job;
}

async function runInstall(serverId: string, packFile: string, index: PackIndex, opts: InstallOptions, job: PackJob): Promise<void> {
  const rt = runtime(serverId);
  const say = (line: string) => {
    job.log.push(line);
    rt.panel(`[Сборка] ${line}`);
  };
  try {
    const target = packTarget(index);
    const before = getServer(serverId);
    // A "mods by list" preset would re-download its own mods on the version switch below.
    await clearPreset(serverId).catch(() => {});
    // The pack chooses the game version and loader; switch the server first if they differ.
    if (before.core !== target.core || before.mc_version !== target.mcVersion || before.core_build !== target.build) {
      say(`Переключаю сервер на ${target.core} ${target.mcVersion}${target.build ? ` (${target.build})` : ""}…`);
      await reinstallServer(serverId, {
        core: target.core,
        mcVersion: target.mcVersion,
        build: target.build ?? undefined,
        java: await recommendJava(target.core, target.mcVersion),
        backupFirst: opts.backupFirst,
      });
      if (getServer(serverId).install_state !== "installed") throw new Error("Не удалось установить ядро под сборку, подробности в консоли");
      opts = { ...opts, backupFirst: false };
    }
    // Right after "create server from pack" the core is still installing: this waits for it (same queue).
    await withServerStopped(serverId, async () => {
      const server = getServer(serverId);
      if (server.install_state !== "installed") throw new Error("Ядро сервера не установлено, сначала исправьте ошибку установки в консоли");
      if (opts.backupFirst) {
        say("Делаю бэкап перед установкой сборки…");
        await createBackup(serverId, `Перед сборкой ${index.name}`);
      }
      const root = dataDirOf(serverId);
      const modsDir = await addonsDir(server);
      if (opts.clearMods) {
        const existing = (await readdir(modsDir)).filter((f) => !f.startsWith("."));
        if (existing.length) {
          const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
          const old = join(root, `mods.old-${stamp}`);
          await rename(modsDir, old);
          await mkdir(modsDir, { recursive: true });
          say(`Старые моды (${existing.length}) перенесены в папку ${basename(old)}`);
        }
      }

      // 1. Server-side files from the index, each checked against its sha512.
      const files = index.files.filter(isServerFile);
      const budget = server.disk_mb * 1024 * 1024 - (await serverDiskBytes(serverId, true));
      const need = files.reduce((a, f) => a + f.fileSize, 0);
      if (need > budget) throw new HttpError(507, `Сборке нужно ${Math.round(need / 1048576)} МБ, а в лимите диска сервера свободно ${Math.round(budget / 1048576)} МБ`);
      say(`Скачиваю ${files.length} файлов (${Math.round(need / 1048576)} МБ)…`);
      const written: string[] = [];
      const queue = [...files];
      const failures: string[] = [];
      await Promise.all(
        Array.from({ length: 6 }, async () => {
          for (let f = queue.shift(); f; f = queue.shift()) {
            const rel = safePackPath(f.path);
            const url = f.downloads.find(allowedDownload);
            if (!rel || !url) {
              failures.push(`${f.path}: ${!rel ? "недопустимый путь" : "ссылка не с Modrinth/GitHub"}`);
              continue;
            }
            const dest = resolveInside(root, rel);
            if (!isWithin(root, dest)) continue;
            await mkdir(dirname(dest), { recursive: true });
            try {
              await downloadFile(url, dest, { checksum: { algorithm: "sha512", hex: f.hashes.sha512 } });
              written.push(rel);
            } catch (err) {
              failures.push(`${basename(rel)}: ${errorMessage(err)}`);
            }
            job.done++;
          }
        }),
      );
      if (failures.length) throw new Error(`Не скачались ${failures.length} файлов: ${failures.slice(0, 5).join("; ")}${failures.length > 5 ? "…" : ""}`);

      // 2. overrides/ then server-overrides/ (the latter wins), client-overrides/ is ignored.
      let copied = 0;
      for (const prefix of ["overrides/", "server-overrides/"]) {
        const zip = await openZip(packFile);
        await eachEntry(zip, async (e) => {
          if (!e.fileName.startsWith(prefix) || e.fileName.endsWith("/")) return;
          const rel = safePackPath(e.fileName.slice(prefix.length));
          if (!rel || SKIP_ON_SERVER.test(rel)) return;
          const dest = resolveInside(root, rel);
          if (!isWithin(root, dest)) return;
          await mkdir(dirname(dest), { recursive: true });
          await pipeline(await entryStream(zip, e), createWriteStream(dest));
          if (!written.includes(rel)) written.push(rel);
          copied++;
        });
      }
      say(`Файлы сборки скачаны, настройки скопированы (${copied})`);

      // 3. Fabric packs sometimes mark a library as client-only although a server mod needs it.
      if (target.core === "fabric") await fixFabricDependencies(index, modsDir, written, say);

      await writeFile(
        markerPath(serverId),
        JSON.stringify({ name: index.name, version: index.versionId, core: target.core, mcVersion: target.mcVersion, installedAt: Date.now(), files: written } satisfies InstalledPack, null, 1),
      );
      await mkdir(dirname(playerPackPath(serverId)), { recursive: true });
      await copyFile(packFile, playerPackPath(serverId));
    });
    invalidateDisk(serverId);
    job.state = "done";
    say(`Готово: ${index.name} ${index.versionId} установлена. Запускайте сервер; первый запуск со сборкой может идти несколько минут.`);
  } catch (err) {
    job.state = "failed";
    job.error = errorMessage(err);
    say(`\x1b[31mУстановка сборки не удалась: ${job.error}\x1b[0m`);
  }
}

async function fixFabricDependencies(index: PackIndex, modsDir: string, written: string[], say: (l: string) => void): Promise<void> {
  const mods: FabricMod[] = [];
  for (const f of (await readdir(modsDir)).filter((n) => n.endsWith(".jar"))) {
    const mod = await readFabricMod(await readFile(join(modsDir, f))).catch(() => null);
    if (mod) mods.push(mod);
  }
  const missing = missingDependencies(mods);
  if (missing.size === 0) return;
  const clientOnly = index.files.filter((f) => !isServerFile(f) && f.path.endsWith(".jar"));
  for (const [dep, neededBy] of missing) {
    const candidates = clientOnly.filter((f) => squash(basename(f.path)).includes(squash(dep)));
    let fixed = false;
    for (const f of candidates) {
      const rel = safePackPath(f.path);
      const url = f.downloads.find(allowedDownload);
      if (!rel || !url) continue;
      const tmp = join(modsDir, `.check-${randomId(6)}.jar`);
      try {
        await downloadFile(url, tmp, { checksum: { algorithm: "sha512", hex: f.hashes.sha512 } });
        const mod = await readFabricMod(await readFile(tmp));
        if (mod?.ids.includes(dep) && !mod.clientOnly) {
          await rename(tmp, join(modsDir, safeJarName(basename(rel))));
          written.push(rel);
          say(`Доставил библиотеку ${dep}: сборка пометила её «только для игрока», но её требует ${neededBy.join(", ")}`);
          fixed = true;
          break;
        }
      } catch {
        // try the next candidate
      } finally {
        await rm(tmp, { force: true });
      }
    }
    if (!fixed) say(`Внимание: мод ${neededBy.join(", ")} требует «${dep}», а в сборке его для сервера нет. Если сервер не запустится, см. консоль.`);
  }
}
