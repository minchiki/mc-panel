import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { en } from "./locales/en";
import { ru, type Messages } from "./locales/ru";

export type Locale = "ru" | "en";
const dictionaries: Record<Locale, Messages> = { ru, en };

type Path<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Path<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Path<Messages>;

function lookup(dict: Messages, key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict);
  return typeof value === "string" ? value : key;
}

/** "{n} игроков" style interpolation. */
function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLocale(): Locale {
  try {
    return localStorage.getItem("mcp-locale") === "en" ? "en" : "ru";
  } catch {
    return "ru";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale: (l) => {
        setLocaleState(l);
        try {
          localStorage.setItem("mcp-locale", l);
        } catch {
          /* ignore */
        }
        document.documentElement.lang = l;
      },
      t: (key, vars) => format(lookup(dictionaries[locale], key), vars),
    }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
