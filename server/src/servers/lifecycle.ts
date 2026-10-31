import { mkdir, rm } from "node:fs/promises";
import { config } from "../config.js";
import { installCore, removeCoreArtifacts } from "../cores/install.js";
import type { Core } from "../cores/types.js";
import { containerName, networkName, removeContainer, removeNetwork } from "../docker/client.js";
import { randomId, randomPassword } from "../lib/crypto.js";
import { conflict, errorMessage } from "../lib/errors.js";
import { dropServerDatabases } from "../databases/service.js";
import { createBackup } from "../backups/service.js";
import { rebuildPresetForNewVersion } from "../plugins/modlist.js";
import { invalidateDisk } from "./disk.js";
import { defaultJvmFlags, writeInitialProperties } from "./prepare.js";
import { allocatePort, backupDirOf, dataDirOf, deleteServerRow, getServer, insertServer, updateServer, type ServerRow } from "./repo.js";
import { forgetRuntime, runtime, withServerStopped, type Runtime } from "./runtime.js";

export interface CreateServerInput {
  ownerId: number;
  name: string;
  core: Core;
  mcVersion: string;
  build?: string;
  java: number;
  ramMb: number;
  cpuLimit: number;
  diskMb: number;
  port?: number;
}

export async function createServer(input: CreateServerInput): Promise<ServerRow> {
  const id = randomId(8);
  const server = insertServer({
    id,
    owner_id: input.ownerId,
    name: input.name,
    core: input.core,
    mc_version: input.mcVersion,
    core_build: input.build ?? null,
    java_version: input.java,
    ram_mb: input.ramMb,
    cpu_limit: input.cpuLimit,
    disk_mb: input.diskMb,
    port: allocatePort(input.port),
    startup: "",
    jvm_flags: defaultJvmFlags(input.core),
    domain: null,
    desired_state: "stopped",
    install_state: "pending",
    auto_restart: 1,
    rcon_password: randomPassword(24),
  });
  await mkdir(dataDirOf(id), { recursive: true });
  await mkdir(backupDirOf(id), { recursive: true });
  await writeInitialProperties(server, input.name);
  // Install in the background; progress streams to the console tab.
  void runtime(id).exclusive(() => runInstall(runtime(id)));
  return server;
}

async function runInstall(rt: Runtime): Promise<void> {
  const server = getServer(rt.id);
  rt.setStatus("installing");
  updateServer(rt.id, { install_state: "installing" });
  rt.panel(`Установка ${server.core} ${server.mc_version}${server.core_build ? ` (${server.core_build})` : ""}...`);
  try {
    const result = await installCore(server.core, {
      serverId: server.id,
      dataDir: dataDirOf(server.id),
      mcVersion: server.mc_version,
      build: server.core_build ?? undefined,
      java: server.java_version,
      log: (line) => rt.log(line),
    });
    updateServer(rt.id, { install_state: "installed", startup: result.startup, core_build: result.build ?? server.core_build });
    rt.panel("Установка завершена. Можно запускать сервер.");
  } catch (err) {
    updateServer(rt.id, { install_state: "failed" });
    rt.panel(`\x1b[31mУстановка не удалась: ${errorMessage(err)}\x1b[0m`);
  } finally {
    invalidateDisk(rt.id);
    rt.setStatus("offline");
  }
}

/** Change core and/or version keeping worlds and configs. Optionally backs up first. */
export async function reinstallServer(
  id: string,
  change: { core: Core; mcVersion: string; build?: string; java: number; backupFirst: boolean },
): Promise<void> {
  const rt = runtime(id);
  if (rt.status === "installing") throw conflict("Установка уже идёт");
  await withServerStopped(id, async () => {
    if (change.backupFirst) {
      rt.panel("Делаю бэкап перед сменой ядра...");
      await createBackup(id, "Перед сменой ядра");
    }
    updateServer(id, {
      core: change.core,
      mc_version: change.mcVersion,
      core_build: change.build ?? null,
      java_version: change.java,
      jvm_flags: getServer(id).core === change.core ? getServer(id).jvm_flags : defaultJvmFlags(change.core),
      // Mark it right away so nobody sees "installed" next to the new version mid-install.
      install_state: "installing",
    });
    rt.setStatus("installing");
    await removeCoreArtifacts(dataDirOf(id));
    await runInstall(rt);
    if (getServer(id).install_state === "installed") {
      await rebuildPresetForNewVersion(getServer(id)).catch((err) => rt.panel(`Пресет модов: ${errorMessage(err)}`));
    }
  });
}

export async function deleteServer(id: string): Promise<void> {
  await withServerStopped(id, async () => {
    await removeContainer(containerName(id));
    await removeNetwork(networkName(id));
    await dropServerDatabases(id);
  });
  forgetRuntime(id);
  deleteServerRow(id);
  await rm(dataDirOf(id), { recursive: true, force: true });
  await rm(backupDirOf(id), { recursive: true, force: true });
}

export function assertWithinOwnerLimits(owner: { id: number; role: string; max_servers: number; max_ram_mb: number }, usage: { servers: number; ramMb: number }, extraRam: number, newServer: boolean): void {
  if (owner.role === "admin") return;
  if (newServer && usage.servers >= owner.max_servers) throw conflict(`Лимит серверов: ${owner.max_servers}`);
  if (usage.ramMb + extraRam > owner.max_ram_mb) throw conflict(`Лимит RAM: ${owner.max_ram_mb} МБ на все серверы`);
}

export const hostLimits = () => ({ portStart: config.PORT_RANGE_START, portEnd: config.PORT_RANGE_END });
