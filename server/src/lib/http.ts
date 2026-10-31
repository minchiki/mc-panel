import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

const USER_AGENT = "mc-panel/0.1 (self-hosted Minecraft panel)";
const DEFAULT_TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [2_000, 6_000];

class UpstreamStatusError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(status === 415 ? `${new URL(url).host} отдал HTML-страницу вместо файла` : `${new URL(url).host} ответил ${status}`);
  }
}

const NETWORK_HINTS: Record<string, string> = {
  UND_ERR_CONNECT_TIMEOUT: "не удалось подключиться за 10 секунд",
  ETIMEDOUT: "соединение не установилось (таймаут)",
  UND_ERR_HEADERS_TIMEOUT: "сервер слишком долго не отвечает",
  UND_ERR_BODY_TIMEOUT: "передача данных остановилась",
  ECONNRESET: "соединение сбросили на полпути",
  ECONNREFUSED: "сервер отклонил соединение",
  ENOTFOUND: "не удалось найти адрес (DNS)",
  EAI_AGAIN: "DNS временно не отвечает",
  ENETUNREACH: "нет маршрута до сервера",
  EHOSTUNREACH: "нет маршрута до сервера",
  CERT_HAS_EXPIRED: "у сервера просрочен сертификат",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "не удалось проверить сертификат сервера",
};

/** Human-readable reason for a low-level network error code (falls back to the code itself). */
export function explainNetworkError(code: string | undefined): string {
  if (!code) return "неизвестная ошибка сети";
  return NETWORK_HINTS[code] ?? code;
}

/** Turns undici's opaque "fetch failed" into "host: не удалось подключиться за 10 секунд (3 попытки)" etc. */
function describe(err: unknown, url: string, attempts = 1): Error {
  if (err instanceof UpstreamStatusError) return err;
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code ?? (err as { code?: string }).code;
  const reason = code ? explainNetworkError(code) : (cause?.message ?? (err as Error).message);
  const tries = attempts > 1 ? `, попыток: ${attempts}` : "";
  return new Error(`${new URL(url).host}: ${reason}${tries}. Это проблема сети между VPS и этим сайтом, а не панели`);
}

const isRetryable = (err: unknown) =>
  err instanceof UpstreamStatusError ? err.status >= 500 || err.status === 429 : err instanceof Error && err.name !== "AbortError";

/**
 * Some mirrors sit behind CDNs that drop connections intermittently from RU
 * networks, so every upstream call gets two retries with backoff.
 */
async function withRetry<T>(url: string, fn: () => Promise<T>, delays: number[] = RETRY_DELAYS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const delay = delays[attempt];
      if (delay === undefined || !isRetryable(err)) throw describe(err, url, attempt + 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export function fetchJson<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS, headers: Record<string, string> = {}): Promise<T> {
  return withRetry(url, async () => {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new UpstreamStatusError(res.status, url);
    return (await res.json()) as T;
  });
}

export function fetchText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return withRetry(url, async () => {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new UpstreamStatusError(res.status, url);
    return res.text();
  });
}

/** One request, no retries: for diagnostics that must show the raw state of the route. */
export async function probe(url: string, timeoutMs = 8_000): Promise<{ url: string; ok: boolean; ms: number; detail: string }> {
  const started = Date.now();
  try {
    const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    return { url, ok: res.status < 500, ms: Date.now() - started, detail: `HTTP ${res.status}` };
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code;
    const detail = (err as Error).name === "TimeoutError" ? "таймаут" : explainNetworkError(code);
    return { url, ok: false, ms: Date.now() - started, detail };
  }
}

export interface Checksum {
  algorithm: "sha1" | "sha256" | "sha512";
  hex: string;
}

/**
 * Download to `dest` atomically (via a .part file), optionally verifying a
 * checksum published by the upstream API. Returns bytes written.
 */
export function downloadFile(url: string, dest: string, opts: { checksum?: Checksum; timeoutMs?: number } = {}): Promise<number> {
  return withRetry(url, () => downloadOnce(url, dest, opts), DOWNLOAD_RETRY_DELAYS_MS);
}

/** More attempts for downloads: a stalled CDN edge is usually fine on the next connection. */
const DOWNLOAD_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];
/** Abort a transfer that delivers less than this per window; some CDN edges are throttled to ~30 KB/s from RU. */
const STALL_WINDOW_MS = 10_000;
const STALL_MIN_BYTES = 64 * 1024;

class StalledError extends Error {
  constructor() {
    super("скачивание почти остановилось");
  }
}

async function downloadOnce(url: string, dest: string, opts: { checksum?: Checksum; timeoutMs?: number }): Promise<number> {
  const part = `${dest}.part`;
  // Clean up before the response body starts flowing, so no chunk can be missed.
  await rm(part, { force: true });
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(opts.timeoutMs ?? 10 * 60_000)]);
  let bytes = 0;
  let lastCheck = 0;
  let stalled = false;
  const watchdog = setInterval(() => {
    if (bytes - lastCheck < STALL_MIN_BYTES) {
      stalled = true;
      controller.abort();
    }
    lastCheck = bytes;
  }, STALL_WINDOW_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal });
    if (!res.ok || !res.body) throw new UpstreamStatusError(res.status, url);
    const contentType = res.headers.get("content-type") ?? "";
    // A login/challenge page instead of the file won't change on retry.
    if (contentType.includes("text/html")) throw new UpstreamStatusError(415, url);
    const hash = opts.checksum ? createHash(opts.checksum.algorithm) : null;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        hash?.update(chunk);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), meter, createWriteStream(part, { flags: "wx" }));
    if (hash && opts.checksum && hash.digest("hex") !== opts.checksum.hex.toLowerCase()) {
      throw new Error(`Контрольная сумма ${new URL(url).pathname.split("/").pop()} не совпала, файл повреждён при скачивании`);
    }
    await rename(part, dest);
  } catch (err) {
    await rm(part, { force: true });
    throw stalled ? new StalledError() : err;
  } finally {
    clearInterval(watchdog);
  }
  return bytes;
}

/** Simple in-memory TTL cache for upstream API lists. */
export function cached<T>(ttlMs: number, loader: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const store = new Map<string, { at: number; value: Promise<T> }>();
  return (key) => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = loader(key);
    store.set(key, { at: Date.now(), value });
    value.catch(() => store.delete(key));
    return value;
  };
}
