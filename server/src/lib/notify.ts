import { getSettings, type NotifyEvents, type PanelSettings } from "./settings.js";
import { errorMessage } from "./errors.js";

const RATE_WINDOW_MS = 10 * 60_000;
const recent = new Map<string, number>();

/** One Telegram sendMessage call, straight or through a relay (token and key travel in headers, not in the URL). */
export function telegramRequest(s: Pick<PanelSettings, "telegramBotToken" | "telegramApiBase" | "telegramRelayKey">, text: string, chatId: string): Promise<Response> {
  const relay = Boolean(s.telegramApiBase && s.telegramRelayKey);
  const url = relay ? `${s.telegramApiBase.replace(/\/+$/, "")}/sendMessage` : `${s.telegramApiBase || "https://api.telegram.org"}/bot${s.telegramBotToken}/sendMessage`;
  return fetch(url, {
    method: "POST",
    headers: relay
      ? { "Content-Type": "application/json", "x-relay-key": s.telegramRelayKey, "x-bot-token": s.telegramBotToken }
      : { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
}

/**
 * Sends an alert to every configured channel if its event type is switched on.
 * The same `key` is sent at most once per 10 minutes so a flapping server can't flood the chat.
 */
export async function notify(key: string, text: string, event: keyof NotifyEvents = "crash"): Promise<void> {
  const s = getSettings();
  if (!s.notifyEvents[event]) return;
  const last = recent.get(key);
  if (last && Date.now() - last < RATE_WINDOW_MS) return;
  recent.set(key, Date.now());
  const jobs: Promise<unknown>[] = [];
  if (s.telegramBotToken && s.telegramChatId) jobs.push(telegramRequest(s, text, s.telegramChatId));
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
    check(Boolean(s.telegramBotToken && s.telegramChatId), () => telegramRequest(s, text, s.telegramChatId)),
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
