import type { Duplex } from "node:stream";
import { config } from "../config.js";
import { one } from "../db/index.js";
import {
  attachContainer,
  containerLogsTail,
  containerName,
  createGameContainer,
  docker,
  ensureImage,
  inspectContainer,
  javaImage,
  pipeLines,
} from "../docker/client.js";
import { conflict, errorMessage } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { serverDiskBytes } from "./disk.js";
import { bus, type LiveStats, type ServerStatus } from "./events.js";
import { closeOpenSessions, parsePlayerAddress, parsePlayerEvent, recordPlayerEvent } from "./players.js";
import { buildCommand, internalPort, isNoiseLine, isReadyLine, prepareFiles, stopCommand } from "./prepare.js";
import { dataDirOf, findServer, getServer, listAllServers, updateServer } from "./repo.js";
import { startStats, type StatsHandle } from "./stats.js";

const CONSOLE_LIMIT = 1000;
const STOP_TIMEOUT_MS = 30_000;
const CRASH_WINDOW_MS = 10 * 60_000;
const CRASH_LIMIT = 3;
const RESTART_DELAY_MS = 5_000;
const CONSOLE_FLUSH_MS = 100;

export class Runtime {
  status: ServerStatus = "offline";
  console: string[] = [];
  input: Duplex | null = null;
  players = new Set<string>();
  /** player -> "ip:port" the game server saw at login; used to find their TCP connection for ping. */
  playerAddrs = new Map<string, string>();
  /** Tab-list ping scoreboard created for this run of the server. */
  pingBoard = false;
  stats: LiveStats | null = null;
  tps: number | null = null;
  startedAt: number | null = null;
  crashes: number[] = [];
  expectingExit = false;
  statsHandle: StatsHandle | null = null;
  private pending: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(readonly id: string) {}

  /** Serialises power operations so two clicks can't start a server twice. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    this.lock = next.catch(() => undefined);
    return next;
  }

  setStatus(status: ServerStatus): void {
    if (this.status === status) return;
    this.status = status;
    bus.emitServer({ type: "status", serverId: this.id, status });
  }

  log(line: string): void {
    this.console.push(line);
    if (this.console.length > CONSOLE_LIMIT) this.console.splice(0, this.console.length - CONSOLE_LIMIT);
    this.pending.push(line);
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null;
      const lines = this.pending;
      this.pending = [];
      bus.emitServer({ type: "console", serverId: this.id, lines });
    }, CONSOLE_FLUSH_MS);
  }

  panel(message: string): void {
    this.log(`\x1b[36m[Панель]\x1b[0m ${message}`);
  }

  setPlayers(players: Iterable<string>): void {
    this.players = new Set(players);
    bus.emitServer({ type: "players", serverId: this.id, players: [...this.players] });
  }
}

const runtimes = new Map<string, Runtime>();

export function runtime(id: string): Runtime {
  let rt = runtimes.get(id);
  if (!rt) {
    rt = new Runtime(id);
    runtimes.set(id, rt);
  }
  return rt;
}

export function forgetRuntime(id: string): void {
  runtime(id).statsHandle?.stop();
  runtimes.delete(id);
}

const isActive = (s: ServerStatus) => s === "starting" || s === "online" || s === "stopping";

// ---------------------------------------------------------------- start

async function doStart(rt: Runtime): Promise<void> {
  if (isActive(rt.status) || rt.status === "installing") return;
  const server = getServer(rt.id);
  if (server.install_state !== "installed") throw conflict("Сервер ещё не установлен");
  const usedMb = (await serverDiskBytes(rt.id, true)) / 1024 / 1024;
  if (usedMb > server.disk_mb) {
    throw conflict(`Превышен лимит диска: ${Math.round(usedMb)} из ${server.disk_mb} МБ. Удалите лишние файлы или увеличьте лимит.`);
  }
  rt.setStatus("starting");
  rt.expectingExit = false;
  try {
    await prepareFiles(server);
    const image = javaImage(server.java_version);
    await ensureImage(image, (l) => rt.panel(l));
    const hasDb = Boolean(one("SELECT 1 FROM databases WHERE server_id = ?", rt.id));
    const container = await createGameContainer({
      serverId: rt.id,
      image,
      uid: config.CONTAINER_UID,
      gid: config.CONTAINER_GID,
      dataDir: dataDirOf(rt.id),
      port: server.port,
      internalPort: internalPort(server.core),
      memoryMb: server.ram_mb,
      cpus: server.cpu_limit,
      command: buildCommand(server),
      joinDbNetwork: hasDb,
    });
    await attachIo(rt);
    rt.panel(`Запуск: Java ${server.java_version}, ${server.ram_mb} МБ RAM, порт ${server.port}`);
    await container.start();
    rt.startedAt = Date.now();
    watchExit(rt);
    rt.statsHandle = startStats(rt.id, server.ram_mb, (s) => {
      rt.stats = s;
      bus.emitServer({ type: "stats", serverId: rt.id, stats: s });
    });
    updateServer(rt.id, { desired_state: "running" });
  } catch (err) {
    rt.panel(`Ошибка запуска: ${errorMessage(err)}`);
    rt.setStatus("offline");
    throw err;
  }
}

async function attachIo(rt: Runtime): Promise<void> {
  const { input, output } = await attachContainer(containerName(rt.id));
  rt.input = input;
  const core = getServer(rt.id).core;
  pipeLines(output, (line) => {
    if (isNoiseLine(line)) return;
    rt.log(line);
    if (rt.status === "starting" && isReadyLine(core, line)) {
      rt.setStatus("online");
      rt.panel("Сервер готов к подключению");
      void notify(`started:${rt.id}`, `🟢 Сервер «${getServer(rt.id).name}» запущен.`, "started");
    }
    const login = parsePlayerAddress(line);
    if (login) rt.playerAddrs.set(login.player, login.address);
    const evt = parsePlayerEvent(line);
    if (evt) {
      recordPlayerEvent(rt.id, evt);
      const next = new Set(rt.players);
      if (evt.kind === "join") next.add(evt.player);
      else {
        next.delete(evt.player);
        rt.playerAddrs.delete(evt.player);
      }
      rt.setPlayers(next);
    }
  });
}

function watchExit(rt: Runtime): void {
  const container = docker.getContainer(containerName(rt.id));
  container
    .wait()
    .then((res: { StatusCode: number }) => onExit(rt, res.StatusCode))
    .catch((err) => rt.panel(`Потеряна связь с контейнером: ${errorMessage(err)}`));
}

function onExit(rt: Runtime, code: number): void {
  rt.statsHandle?.stop();
  rt.statsHandle = null;
  rt.stats = null;
  rt.input = null;
  rt.startedAt = null;
  rt.tps = null;
  rt.playerAddrs.clear();
  rt.pingBoard = false;
  closeOpenSessions(rt.id);
  rt.setPlayers([]);
  const server = findServer(rt.id);
  if (!server) return;
  if (rt.expectingExit) {
    rt.panel("Сервер остановлен");
    void notify(`stopped:${rt.id}`, `🔴 Сервер «${server.name}» остановлен.`, "stopped");
    rt.setStatus("offline");
    return;
  }
  rt.panel(`Сервер неожиданно завершился (код ${code})`);
  rt.setStatus("crashed");
  if (!server.auto_restart || server.desired_state !== "running") {
    void notify(`crash:${rt.id}`, `⚠️ Сервер «${server.name}» упал (код ${code}).`);
    return;
  }
  const now = Date.now();
  rt.crashes = [...rt.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
  if (rt.crashes.length >= CRASH_LIMIT) {
    rt.panel(`${CRASH_LIMIT} падения за 10 минут: авто-рестарт отключён до ручного запуска`);
    updateServer(rt.id, { desired_state: "stopped" });
    void notify(`crashloop:${rt.id}`, `🛑 Сервер «${server.name}» падает раз за разом (${CRASH_LIMIT} раза за 10 мин). Авто-рестарт остановлен.`);
    return;
  }
  void notify(`crash:${rt.id}`, `⚠️ Сервер «${server.name}» упал (код ${code}), перезапускаю.`);
  rt.panel(`Перезапуск через ${RESTART_DELAY_MS / 1000} с (попытка ${rt.crashes.length} из ${CRASH_LIMIT - 1})`);
  setTimeout(() => {
    if (findServer(rt.id)?.desired_state === "running") {
      rt.exclusive(() => doStart(rt)).catch(() => undefined);
    }
  }, RESTART_DELAY_MS);
}

// ---------------------------------------------------------------- stop

async function doStop(rt: Runtime): Promise<void> {
  updateServer(rt.id, { desired_state: "stopped" });
  const info = await inspectContainer(containerName(rt.id));
  if (!info?.State.Running) {
    rt.setStatus("offline");
    return;
  }
  rt.expectingExit = true;
  rt.setStatus("stopping");
  const server = getServer(rt.id);
  rt.panel("Останавливаю сервер...");
  rt.input?.write(`${stopCommand(server.core)}\n`);
  const container = docker.getContainer(containerName(rt.id));
  const exited = await Promise.race([
    container.wait().then(() => true),
    new Promise<false>((r) => setTimeout(() => r(false), STOP_TIMEOUT_MS)),
  ]);
  if (!exited) {
    rt.panel(`Сервер не остановился за ${STOP_TIMEOUT_MS / 1000} с, принудительное завершение`);
    await container.kill().catch(() => undefined);
  }
}

async function doKill(rt: Runtime): Promise<void> {
  updateServer(rt.id, { desired_state: "stopped" });
  rt.expectingExit = true;
  const info = await inspectContainer(containerName(rt.id));
  if (info?.State.Running) {
    rt.panel("Принудительное завершение (kill)");
    await docker.getContainer(containerName(rt.id)).kill();
  } else {
    rt.setStatus("offline");
  }
}

// ---------------------------------------------------------------- public API

export const startServer = (id: string) => {
  const rt = runtime(id);
  rt.crashes = [];
  return rt.exclusive(() => doStart(rt));
};
export const stopServer = (id: string) => runtime(id).exclusive(() => doStop(runtime(id)));
export const killServer = (id: string) => doKill(runtime(id));
export const restartServer = (id: string) =>
  runtime(id).exclusive(async () => {
    const rt = runtime(id);
    await doStop(rt);
    await waitForStatus(rt, ["offline", "crashed"], STOP_TIMEOUT_MS + 5000);
    rt.crashes = [];
    await doStart(rt);
  });

/** Run `fn` while the server is guaranteed offline; used by install/restore. */
export function withServerStopped<T>(id: string, fn: (rt: Runtime) => Promise<T>): Promise<T> {
  const rt = runtime(id);
  return rt.exclusive(async () => {
    if (isActive(rt.status)) {
      await doStop(rt);
      await waitForStatus(rt, ["offline", "crashed"], STOP_TIMEOUT_MS + 5000);
    }
    return fn(rt);
  });
}

export function sendCommand(id: string, command: string): void {
  const rt = runtime(id);
  if (!rt.input || !(rt.status === "online" || rt.status === "starting")) throw conflict("Сервер не запущен");
  const clean = command.replace(/[\r\n]+/g, " ").trim();
  if (!clean) return;
  rt.log(`\x1b[90m> ${clean}\x1b[0m`);
  rt.input.write(`${clean}\n`);
}

function waitForStatus(rt: Runtime, statuses: ServerStatus[], timeoutMs: number): Promise<void> {
  if (statuses.includes(rt.status)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    const off = bus.onServer((e) => {
      if (e.type === "status" && e.serverId === rt.id && statuses.includes(e.status)) done();
    });
    function done() {
      clearTimeout(timer);
      off();
      resolve();
    }
  });
}

/**
 * On panel boot: re-attach to containers that kept running while the panel was
 * down, and start servers that should be running (e.g. after a VPS reboot).
 */
export async function reconcileAll(): Promise<void> {
  for (const server of listAllServers()) {
    const rt = runtime(server.id);
    try {
      if (server.install_state === "installing") updateServer(server.id, { install_state: "failed" });
      const info = await inspectContainer(containerName(server.id));
      if (info?.State.Running) {
        const history = await containerLogsTail(containerName(server.id), 200);
        for (const line of history.split(/\r?\n/)) if (line && !isNoiseLine(line)) rt.log(line);
        await attachIo(rt);
        rt.setStatus("online");
        rt.startedAt = Date.parse(info.State.StartedAt) || Date.now();
        watchExit(rt);
        rt.statsHandle = startStats(server.id, server.ram_mb, (s) => {
          rt.stats = s;
          bus.emitServer({ type: "stats", serverId: server.id, stats: s });
        });
      } else if (server.desired_state === "running" && server.install_state === "installed") {
        rt.panel("Автозапуск после перезапуска панели/VPS");
        await startServer(server.id);
      }
    } catch (err) {
      rt.panel(`Не удалось восстановить состояние: ${errorMessage(err)}`);
    }
  }
}
