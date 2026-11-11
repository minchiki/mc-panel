import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { buildImage, ensureImage, javaImage, runOneShot } from "../docker/client.js";
import { downloadFile, fetchJson, type Checksum } from "../lib/http.js";
import { mojangVersion } from "./versions.js";
import type { Core, InstallContext, InstallResult } from "./types.js";

const JAR_STARTUP = "java {{XMS}} {{XMX}} {{FLAGS}} -jar server.jar nogui";
const PROXY_STARTUP = "java {{XMS}} {{XMX}} {{FLAGS}} -jar server.jar";

async function vanilla(ctx: InstallContext): Promise<InstallResult> {
  const meta = await mojangVersion(ctx.mcVersion);
  const server = meta.downloads.server;
  if (!server) throw new Error(`У версии ${ctx.mcVersion} нет серверного jar`);
  await fetchTo(ctx, server.url, "server.jar", { algorithm: "sha1", hex: server.sha1 });
  return { startup: JAR_STARTUP };
}

async function paperFamily(ctx: InstallContext, project: "paper" | "velocity"): Promise<InstallResult> {
  const build = await fetchJson<{ id: number; downloads: Record<string, { url: string; checksums?: { sha256?: string } }> }>(
    `https://fill.papermc.io/v3/projects/${project}/versions/${encodeURIComponent(ctx.mcVersion)}/builds/latest`,
  );
  const dl = build.downloads["server:default"];
  if (!dl?.url) throw new Error(`PaperMC не отдал ссылку на ${project} ${ctx.mcVersion}`);
  const sha256 = dl.checksums?.sha256;
  await fetchTo(ctx, dl.url, "server.jar", sha256 ? { algorithm: "sha256", hex: sha256 } : undefined);
  return { startup: project === "velocity" ? PROXY_STARTUP : JAR_STARTUP, build: String(build.id) };
}

async function purpur(ctx: InstallContext): Promise<InstallResult> {
  const info = await fetchJson<{ builds: { latest: string } }>(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(ctx.mcVersion)}`);
  await fetchTo(ctx, `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(ctx.mcVersion)}/latest/download`, "server.jar");
  return { startup: JAR_STARTUP, build: info.builds.latest };
}

async function fabric(ctx: InstallContext): Promise<InstallResult> {
  const [loaders, installers] = await Promise.all([
    fetchJson<{ loader: { version: string; stable: boolean } }[]>(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(ctx.mcVersion)}`),
    fetchJson<{ version: string; stable: boolean }[]>("https://meta.fabricmc.net/v2/versions/installer"),
  ]);
  // A pinned loader (e.g. from a modpack) wins; otherwise the newest stable one.
  const loader = (ctx.build && loaders.some((l) => l.loader.version === ctx.build) ? ctx.build : undefined) ?? loaders.find((l) => l.loader.stable)?.loader.version ?? loaders[0]?.loader.version;
  const installer = installers.find((i) => i.stable)?.version ?? installers[0]?.version;
  if (!loader || !installer) throw new Error(`Fabric не поддерживает ${ctx.mcVersion}`);
  await fetchTo(
    ctx,
    `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(ctx.mcVersion)}/${loader}/${installer}/server/jar`,
    "server.jar",
  );
  return { startup: JAR_STARTUP, build: loader };
}

/** Forge and NeoForge share the installer flow; only coordinates differ. */
async function forgeLike(ctx: InstallContext, kind: "forge" | "neoforge"): Promise<InstallResult> {
  if (!ctx.build) throw new Error("Не выбрана сборка загрузчика");
  const full = kind === "forge" ? `${ctx.mcVersion}-${ctx.build}` : ctx.build;
  const url =
    kind === "forge"
      ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`
      : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${full}/neoforge-${full}-installer.jar`;
  await fetchTo(ctx, url, "installer.jar");
  const image = javaImage(ctx.java);
  await ensureImage(image, ctx.log);
  ctx.log("Запускаю установщик (это займёт 1–3 минуты)...");
  const code = await runOneShot({
    image,
    cmd: ["java", "-jar", "installer.jar", "--installServer"],
    binds: [`${ctx.dataDir}:/data`],
    uid: config.CONTAINER_UID,
    gid: config.CONTAINER_GID,
    memoryMb: 2048,
    onLine: ctx.log,
  });
  await rm(join(ctx.dataDir, "installer.jar"), { force: true });
  await rm(join(ctx.dataDir, "installer.jar.log"), { force: true });
  if (code !== 0) throw new Error(`Установщик завершился с кодом ${code}`);

  const group = kind === "forge" ? "net/minecraftforge/forge" : "net/neoforged/neoforge";
  const argsFile = `libraries/${group}/${full}/unix_args.txt`;
  if (await exists(join(ctx.dataDir, argsFile))) {
    return { startup: `java {{XMS}} {{XMX}} {{FLAGS}} @${argsFile} nogui`, build: ctx.build };
  }
  // Pre-1.17 Forge produces a runnable forge-<ver>.jar instead of an args file.
  const jar = (await readdir(ctx.dataDir)).find((f) => f.startsWith("forge-") && f.endsWith(".jar") && !f.includes("installer"));
  if (!jar) throw new Error("Установщик не создал файлы запуска");
  return { startup: `java {{XMS}} {{XMX}} {{FLAGS}} -jar ${jar} nogui`, build: ctx.build };
}

async function spigot(ctx: InstallContext): Promise<InstallResult> {
  const tag = `mc-panel/buildtools:${ctx.java}`;
  ctx.log("Готовлю образ BuildTools (один раз для каждой версии Java)...");
  await buildImage(
    tag,
    `FROM eclipse-temurin:${ctx.java}-jdk\nRUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*\n`,
    ctx.log,
  );
  const cacheDir = join(config.SERVERS_DIR, "..", "cache", "buildtools");
  await mkdir(cacheDir, { recursive: true });
  await downloadFile("https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar", join(cacheDir, "BuildTools.jar"));
  ctx.log("Собираю Spigot через BuildTools (5–10 минут)...");
  const code = await runOneShot({
    image: tag,
    cmd: ["java", "-jar", "BuildTools.jar", "--rev", ctx.mcVersion, "--output-dir", "/data", "--final-name", "server.jar"],
    binds: [`${ctx.dataDir}:/data`, `${cacheDir}:/build`],
    workingDir: "/build",
    env: ["HOME=/build"],
    uid: config.CONTAINER_UID,
    gid: config.CONTAINER_GID,
    memoryMb: 3072,
    onLine: ctx.log,
  });
  if (code !== 0) throw new Error(`BuildTools завершился с кодом ${code}`);
  return { startup: JAR_STARTUP };
}

async function bungeecord(ctx: InstallContext): Promise<InstallResult> {
  await fetchTo(ctx, "https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar", "server.jar");
  return { startup: PROXY_STARTUP };
}

const installers: Record<Core, (ctx: InstallContext) => Promise<InstallResult>> = {
  vanilla,
  paper: (ctx) => paperFamily(ctx, "paper"),
  purpur,
  spigot,
  fabric,
  forge: (ctx) => forgeLike(ctx, "forge"),
  neoforge: (ctx) => forgeLike(ctx, "neoforge"),
  velocity: (ctx) => paperFamily(ctx, "velocity"),
  bungeecord,
};

export function installCore(core: Core, ctx: InstallContext): Promise<InstallResult> {
  return installers[core](ctx);
}

/** Files that belong to the server software, not to the world or configs. */
const CORE_ARTIFACTS = ["server.jar", "libraries", "versions", ".fabric", "cache", "run.sh", "run.bat", "bundler"];

export async function removeCoreArtifacts(dataDir: string): Promise<void> {
  for (const name of CORE_ARTIFACTS) await rm(join(dataDir, name), { recursive: true, force: true });
  for (const f of await readdir(dataDir)) {
    if (/^(forge|neoforge)-.*\.jar$/.test(f)) await rm(join(dataDir, f), { force: true });
  }
}

async function fetchTo(ctx: InstallContext, url: string, fileName: string, checksum?: Checksum): Promise<void> {
  ctx.log(`Скачиваю ${fileName} (${new URL(url).host})...`);
  const tmp = join(ctx.dataDir, `.${fileName}.download`);
  const bytes = await downloadFile(url, tmp, { checksum, insideRoot: ctx.dataDir });
  await rename(tmp, join(ctx.dataDir, fileName));
  ctx.log(`Готово: ${fileName}, ${(bytes / 1024 / 1024).toFixed(1)} МБ${checksum ? `, ${checksum.algorithm} проверена` : ""}`);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}
