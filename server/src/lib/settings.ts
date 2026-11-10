import { one, run } from "../db/index.js";

/** Events that can be sent to Telegram/Discord; each one is switched on or off in the admin settings. */
export interface NotifyEvents {
  started: boolean;
  stopped: boolean;
  crash: boolean;
  backupOk: boolean;
  backupFailed: boolean;
  disk: boolean;
}

export interface PanelSettings {
  registrationEnabled: boolean;
  accentColor: string;
  panelName: string;
  telegramBotToken: string;
  telegramChatId: string;
  /** Optional Telegram API address for hosts where api.telegram.org is blocked (a relay, see docs). */
  telegramApiBase: string;
  telegramRelayKey: string;
  discordWebhook: string;
  notifyEvents: NotifyEvents;
  diskAlertPercent: number;
  curseforgeApiKey: string;
  /** Outgoing mail for password reset. Port 465 = TLS from the start, 587/25 = STARTTLS. */
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  /** "MC Panel <panel@example.com>" or a bare address. */
  smtpFrom: string;
  /** Public address of the panel, used for links in emails (never taken from the request Host header). */
  panelUrl: string;
  /** Personal data operator shown in the privacy policy and consent (152-FZ): a full name or organisation. */
  operatorName: string;
  /** Where to send personal data requests: an email or @telegram. */
  operatorContact: string;
  /** AI assistant: OpenRouter key, optional relay (for hosts where openrouter.ai is blocked) and model list. */
  aiApiKey: string;
  aiApiBase: string;
  aiRelayKey: string;
  aiModels: string;
}

const DEFAULTS: PanelSettings = {
  registrationEnabled: false,
  accentColor: "#22c55e",
  panelName: "MC Panel",
  telegramBotToken: "",
  telegramChatId: "",
  telegramApiBase: "",
  telegramRelayKey: "",
  discordWebhook: "",
  notifyEvents: { started: false, stopped: false, crash: true, backupOk: false, backupFailed: true, disk: true },
  diskAlertPercent: 90,
  curseforgeApiKey: "",
  smtpHost: "",
  smtpPort: 465,
  smtpUser: "",
  smtpPass: "",
  smtpFrom: "",
  panelUrl: "",
  operatorName: "",
  operatorContact: "",
  aiApiKey: "",
  aiApiBase: "",
  aiRelayKey: "",
  aiModels: "",
};

export function getSettings(): PanelSettings {
  const row = one<{ value: string }>("SELECT value FROM settings WHERE key = 'panel'");
  if (!row) return { ...DEFAULTS, notifyEvents: { ...DEFAULTS.notifyEvents } };
  const stored = JSON.parse(row.value) as Partial<PanelSettings>;
  return { ...DEFAULTS, ...stored, notifyEvents: { ...DEFAULTS.notifyEvents, ...stored.notifyEvents } };
}

export function updateSettings(patch: Partial<Omit<PanelSettings, "notifyEvents">> & { notifyEvents?: Partial<NotifyEvents> }): PanelSettings {
  const current = getSettings();
  const next = { ...current, ...patch, notifyEvents: { ...current.notifyEvents, ...patch.notifyEvents } };
  run(
    "INSERT INTO settings (key, value) VALUES ('panel', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    JSON.stringify(next),
  );
  return next;
}

/** Password reset by email works only when the panel can both send mail and build a link. */
export function mailConfigured(s: PanelSettings = getSettings()): boolean {
  return Boolean(s.smtpHost && (s.smtpFrom || s.smtpUser) && s.panelUrl);
}

/** Settings safe to expose to any visitor (login page needs name/colour/registration flag). */
export function publicSettings(): Pick<PanelSettings, "registrationEnabled" | "accentColor" | "panelName" | "operatorName" | "operatorContact"> & { passwordReset: boolean; ai: boolean } {
  const s = getSettings();
  return {
    registrationEnabled: s.registrationEnabled,
    accentColor: s.accentColor,
    panelName: s.panelName,
    passwordReset: mailConfigured(s),
    operatorName: s.operatorName,
    operatorContact: s.operatorContact,
    ai: Boolean(s.aiApiKey),
  };
}
