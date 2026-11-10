import { Agent, fetch as undiciFetch } from "undici";

// Some routes from Russian VPSes to Vercel/Telegram silently drop about one new TCP flow in four.
// Waiting the default 10 s for such a connection is pointless: a fresh one a moment later works.
// So connecting gets a short deadline and is retried at once; established connections are reused.
const dispatcher = new Agent({ connect: { timeout: 2500 }, keepAliveTimeout: 30_000 });
const RETRYABLE = new Set(["UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN", "ECONNREFUSED"]);

export async function netFetch(url: string, init: Parameters<typeof undiciFetch>[1] = {}, attempts = 6) {
  for (let i = 1; ; i++) {
    try {
      return await undiciFetch(url, { ...init, dispatcher });
    } catch (err) {
      const code = (err as { cause?: { code?: string } }).cause?.code;
      if (i >= attempts || !code || !RETRYABLE.has(code)) throw err;
    }
  }
}
