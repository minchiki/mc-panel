import { getSettings } from "./settings.js";
import { errorMessage } from "./errors.js";

const RATE_WINDOW_MS = 10 * 60_000;
const recent = new Map<string, number>();

/**
 * Sends an alert to every configured channel. The same `key` is sent at most
 * once per 10 minutes so a flapping server can't flood the chat.
 */
export async function notify(key: string, text: string): Promise<void> {
  const last = recent.get(key);
  if (last && Date.now() - last < RATE_WINDOW_MS) return;
  recent.set(key, Date.now());
  const s = getSettings();
  const jobs: Promise<unknown>[] = [];
  if (s.telegramBotToken && s.telegramChatId) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${s.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: s.telegramChatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      }),
    );
  }
  if (s.discordWebhook) {
    jobs.push(
      fetch(s.discordWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text.slice(0, 1900) }),
        signal: AbortSignal.timeout(10_000),
      }),
    );
  }
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === "rejected") console.error(`notify failed: ${errorMessage(r.reason)}`);
}

export async function sendTestNotification(): Promise<{ telegram: string; discord: string }> {
  const s = getSettings();
  const check = async (enabled: boolean, fn: () => Promise<Response>) => {
    if (!enabled) return "не настроено";
    try {
      const res = await fn();
      return res.ok ? "ok" : `ошибка HTTP ${res.status}`;
    } catch (err) {
      return `ошибка: ${errorMessage(err)}`;
    }
  };
  const text = "✅ Тестовое уведомление MC Panel";
  const [telegram, discord] = await Promise.all([
    check(Boolean(s.telegramBotToken && s.telegramChatId), () =>
      fetch(`https://api.telegram.org/bot${s.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: s.telegramChatId, text }),
        signal: AbortSignal.timeout(10_000),
      }),
    ),
    check(Boolean(s.discordWebhook), () =>
      fetch(s.discordWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
        signal: AbortSignal.timeout(10_000),
      }),
    ),
  ]);
  return { telegram, discord };
}
