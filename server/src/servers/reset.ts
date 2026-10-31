import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createBackup } from "../backups/service.js";
import { conflict } from "../lib/errors.js";
import { assertFileName, resolveExisting } from "../lib/paths.js";
import { parseProperties, toRecord } from "../lib/properties.js";
import { addonsDir } from "../plugins/catalog.js";
import { clearPreset } from "../plugins/modlist.js";
import { invalidateDisk } from "./disk.js";
import { dataDirOf, type ServerRow } from "./repo.js";
import { runtime, withServerStopped } from "./runtime.js";

// Vanilla keeps dimensions inside the level folder; Bukkit forks split them out.
const DIMENSION_SUFFIXES = ["", "_nether", "_the_end"];

async function levelName(serverId: string): Promise<string> {
  const text = await resolveExisting(dataDirOf(serverId), "server.properties")
    .then((p) => readFile(p, "utf8"))
    .catch(() => "");
  const name = toRecord(parseProperties(text))["level-name"]?.trim() || "world";
  assertFileName(name);
  return name;
}

function assertNotInstalling(serverId: string): void {
  if (runtime(serverId).status === "installing") throw conflict("Сервер сейчас устанавливается");
}

/** Delete the world folders so the next start generates a fresh world (same seed unless level-seed changed). */
export async function resetWorld(server: ServerRow, backupFirst: boolean): Promise<string[]> {
  assertNotInstalling(server.id);
  return withServerStopped(server.id, async (rt) => {
    if (backupFirst) {
      rt.panel("Делаю бэкап перед пересозданием мира...");
      await createBackup(server.id, "Перед пересозданием мира");
    }
    const level = await levelName(server.id);
    const removed = DIMENSION_SUFFIXES.map((s) => `${level}${s}`);
    for (const dir of removed) await rm(join(dataDirOf(server.id), dir), { recursive: true, force: true });
    invalidateDisk(server.id);
    rt.panel(`Мир удалён (${removed.join(", ")}). При следующем запуске создастся новый.`);
    return removed;
  });
}

/** Remove every jar from mods/ (or plugins/) and forget the mod-list preset. Configs stay. */
export async function resetAddons(server: ServerRow): Promise<number> {
  assertNotInstalling(server.id);
  return withServerStopped(server.id, async (rt) => {
    await clearPreset(server.id);
    const dir = await addonsDir(server);
    const jars = (await readdir(dir)).filter((f) => f.endsWith(".jar") || f.endsWith(".jar.disabled"));
    for (const file of jars) await rm(join(dir, file), { force: true });
    invalidateDisk(server.id);
    rt.panel(`Удалено файлов из ${dir.split(/[\\/]/).pop()}/: ${jars.length}`);
    return jars.length;
  });
}
