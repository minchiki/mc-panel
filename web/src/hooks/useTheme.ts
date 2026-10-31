import { useCallback, useState } from "react";

export type Theme = "dark" | "light";

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void } {
  const [theme, setThemeState] = useState<Theme>(() => (document.documentElement.classList.contains("dark") ? "dark" : "light"));
  const setTheme = useCallback((t: Theme) => {
    document.documentElement.classList.toggle("dark", t === "dark");
    try {
      localStorage.setItem("mcp-theme", t);
    } catch {
      /* ignore */
    }
    setThemeState(t);
  }, []);
  return { theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
