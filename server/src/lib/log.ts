import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";

let ready: Promise<void> | null = null;

/**
 * Failed logins go to a dedicated file in a fixed format so fail2ban can parse it:
 * `<ISO time> AUTH_FAIL ip=<ip> user=<name>`.
 */
export async function logAuthFailure(ip: string, username: string): Promise<void> {
  ready ??= mkdir(config.LOG_DIR, { recursive: true }).then(() => undefined);
  await ready;
  const safeUser = username.replace(/[^\w.@-]/g, "?").slice(0, 64);
  await appendFile(join(config.LOG_DIR, "auth.log"), `${new Date().toISOString()} AUTH_FAIL ip=${ip} user=${safeUser}\n`);
}
