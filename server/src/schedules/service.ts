import { Cron } from "croner";
import { config } from "../config.js";
import { all, one, run } from "../db/index.js";
import { createBackup } from "../backups/service.js";
import { badRequest, errorMessage, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { runtime, restartServer, sendCommand, startServer, stopServer } from "../servers/runtime.js";

export const SCHEDULE_ACTIONS = ["restart", "start", "stop", "command", "backup", "broadcast"] as const;
export type ScheduleAction = (typeof SCHEDULE_ACTIONS)[number];

export interface ScheduleRow {
  id: number;
  server_id: string;
  name: string;
  cron: string;
  action: ScheduleAction;
  payload: string;
  enabled: number;
  last_run_at: number | null;
  last_result: string | null;
}

const jobs = new Map<number, Cron>();

export function validateCron(expr: string): void {
  try {
    new Cron(expr, { paused: true, timezone: config.TZ }).stop();
  } catch (err) {
    throw badRequest(`Неверное cron-выражение: ${errorMessage(err)}`);
  }
}

export function nextRuns(expr: string, count = 3): number[] {
  const job = new Cron(expr, { paused: true, timezone: config.TZ });
  const runs = job.nextRuns(count).map((d) => d.getTime());
  job.stop();
  return runs;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** For "restart" the payload is an optional warning lead time in seconds. */
async function execute(s: ScheduleRow): Promise<string> {
  const rt = runtime(s.server_id);
  switch (s.action) {
    case "restart": {
      const warn = Math.min(Number(s.payload) || 0, 600);
      if (warn > 0 && rt.status === "online") {
        sendCommand(s.server_id, `say Сервер перезапустится через ${warn} сек.`);
        await sleep(warn * 1000);
      }
      await restartServer(s.server_id);
      return "перезапущен";
    }
    case "start":
      await startServer(s.server_id);
      return "запущен";
    case "stop":
      await stopServer(s.server_id);
      return "остановлен";
    case "command":
      sendCommand(s.server_id, s.payload);
      return "команда отправлена";
    case "broadcast":
      sendCommand(s.server_id, `say ${s.payload}`);
      return "сообщение отправлено";
    case "backup":
      await createBackup(s.server_id, s.payload || `Авто: ${s.name}`);
      return "бэкап создан";
  }
}

export async function runSchedule(id: number): Promise<void> {
  const s = one<ScheduleRow>("SELECT * FROM schedules WHERE id = ?", id);
  if (!s) return;
  let result: string;
  try {
    result = await execute(s);
  } catch (err) {
    result = `ошибка: ${errorMessage(err)}`;
    runtime(s.server_id).panel(`Задача «${s.name}»: ${result}`);
  }
  run("UPDATE schedules SET last_run_at = ?, last_result = ? WHERE id = ?", Date.now(), result, id);
  audit({ serverId: s.server_id, action: "schedule.run", details: { name: s.name, result } });
}

function arm(s: ScheduleRow): void {
  jobs.get(s.id)?.stop();
  jobs.delete(s.id);
  if (!s.enabled) return;
  jobs.set(s.id, new Cron(s.cron, { timezone: config.TZ, protect: true }, () => void runSchedule(s.id)));
}

export function loadAllSchedules(): void {
  for (const s of all<ScheduleRow>("SELECT * FROM schedules")) arm(s);
}

export function listSchedules(serverId: string): (ScheduleRow & { next: number[] })[] {
  return all<ScheduleRow>("SELECT * FROM schedules WHERE server_id = ? ORDER BY id", serverId).map((s) => ({
    ...s,
    next: s.enabled ? nextRuns(s.cron, 1) : [],
  }));
}

export function saveSchedule(
  serverId: string,
  input: { id?: number; name: string; cron: string; action: ScheduleAction; payload: string; enabled: boolean },
): ScheduleRow {
  validateCron(input.cron);
  let id = input.id;
  if (id !== undefined) {
    if (!one("SELECT 1 FROM schedules WHERE id = ? AND server_id = ?", id, serverId)) throw notFound("Задача", "f");
    run(
      "UPDATE schedules SET name = ?, cron = ?, action = ?, payload = ?, enabled = ? WHERE id = ?",
      input.name,
      input.cron,
      input.action,
      input.payload,
      input.enabled ? 1 : 0,
      id,
    );
  } else {
    id = run(
      "INSERT INTO schedules (server_id, name, cron, action, payload, enabled) VALUES (?, ?, ?, ?, ?, ?)",
      serverId,
      input.name,
      input.cron,
      input.action,
      input.payload,
      input.enabled ? 1 : 0,
    ).lastInsertRowid;
  }
  const row = one<ScheduleRow>("SELECT * FROM schedules WHERE id = ?", id)!;
  arm(row);
  return row;
}

export function deleteSchedule(serverId: string, id: number): void {
  if (run("DELETE FROM schedules WHERE id = ? AND server_id = ?", id, serverId).changes === 0) throw notFound("Задача", "f");
  jobs.get(id)?.stop();
  jobs.delete(id);
}

export function stopServerSchedules(serverId: string): void {
  for (const s of all<{ id: number }>("SELECT id FROM schedules WHERE server_id = ?", serverId)) {
    jobs.get(s.id)?.stop();
    jobs.delete(s.id);
  }
}
