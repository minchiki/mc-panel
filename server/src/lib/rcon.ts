import { Socket } from "node:net";

const AUTH = 3;
const EXEC = 2;
const TIMEOUT_MS = 3000;

/**
 * Minimal Source RCON client, used only for quiet queries (`list`, `tps`) so they
 * don't spam the console. One connection per call keeps it stateless.
 */
export async function rconExec(host: string, port: number, password: string, command: string): Promise<string> {
  const socket = new Socket();
  socket.setTimeout(TIMEOUT_MS);
  let buffer = Buffer.alloc(0);
  const waiters = new Map<number, (body: string) => void>();

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const len = buffer.readInt32LE(0);
      if (buffer.length < len + 4) break;
      const id = buffer.readInt32LE(4);
      const body = buffer.subarray(12, 4 + len - 2).toString("utf8");
      buffer = buffer.subarray(len + 4);
      waiters.get(id)?.(body);
    }
  });

  const send = (id: number, type: number, body: string) =>
    new Promise<string>((resolve, reject) => {
      const payload = Buffer.from(body, "utf8");
      const packet = Buffer.alloc(14 + payload.length);
      packet.writeInt32LE(10 + payload.length, 0);
      packet.writeInt32LE(id, 4);
      packet.writeInt32LE(type, 8);
      payload.copy(packet, 12);
      waiters.set(id, resolve);
      // Failed auth answers with id -1.
      if (type === AUTH) waiters.set(-1, () => reject(new Error("RCON: неверный пароль")));
      socket.write(packet);
    });

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("timeout", () => reject(new Error("RCON: таймаут")));
      socket.connect(port, host, resolve);
    });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("RCON: таймаут")), TIMEOUT_MS));
    await Promise.race([send(1, AUTH, password), timeout]);
    return await Promise.race([send(2, EXEC, command), timeout]);
  } finally {
    socket.destroy();
  }
}

export const stripColors = (s: string) => s.replace(/§[0-9a-fk-or]/gi, "").replace(/\x1b\[[0-9;]*m/g, "");

/** "There are 2 of a max of 20 players online: Alex, Steve" → ["Alex","Steve"]. */
export function parseListResponse(text: string): { online: number; max: number; players: string[] } | null {
  const clean = stripColors(text);
  const m = /There are (\d+) (?:of a max of|out of maximum) (\d+) players online[.:]?\s*(.*)$/s.exec(clean.trim());
  if (!m) return null;
  const players = (m[3] ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_.]{1,16}$/.test(s));
  return { online: Number(m[1]), max: Number(m[2]), players };
}

/** Paper/Purpur: "TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0" (with colour codes, may be "*20.0"). */
export function parseTpsResponse(text: string): number | null {
  const m = /TPS from last[^:]*:\s*\*?([\d.]+)/.exec(stripColors(text));
  return m ? Number(m[1]) : null;
}
