import { one, run } from "../db/index.js";

export interface PanelSettings {
  registrationEnabled: boolean;
  accentColor: string;
  panelName: string;
  telegramBotToken: string;
  telegramChatId: string;
  discordWebhook: string;
  diskAlertPercent: number;
  curseforgeApiKey: string;
}

const DEFAULTS: PanelSettings = {
  registrationEnabled: false,
  accentColor: "#22c55e",
  panelName: "MC Panel",
  telegramBotToken: "",
  telegramChatId: "",
  discordWebhook: "",
  diskAlertPercent: 90,
  curseforgeApiKey: "",
};

export function getSettings(): PanelSettings {
  const row = one<{ value: string }>("SELECT value FROM settings WHERE key = 'panel'");
  if (!row) return { ...DEFAULTS };
  return { ...DEFAULTS, ...(JSON.parse(row.value) as Partial<PanelSettings>) };
}

export function updateSettings(patch: Partial<PanelSettings>): PanelSettings {
  const next = { ...getSettings(), ...patch };
  run(
    "INSERT INTO settings (key, value) VALUES ('panel', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    JSON.stringify(next),
  );
  return next;
}

/** Settings safe to expose to any visitor (login page needs name/colour/registration flag). */
export function publicSettings(): Pick<PanelSettings, "registrationEnabled" | "accentColor" | "panelName"> {
  const s = getSettings();
  return { registrationEnabled: s.registrationEnabled, accentColor: s.accentColor, panelName: s.panelName };
}
