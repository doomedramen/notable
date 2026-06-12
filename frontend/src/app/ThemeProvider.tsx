import { useEffect, type ReactNode } from "react";
import { resolveTheme, useUI } from "../store/ui";

const THEME_COLORS = { light: "#ffffff", dark: "#1e1e2e" } as const;

/** Applies the resolved theme to <html data-theme> and keeps it in sync
    with the OS preference when set to "system". The pre-paint script in
    index.html does the same thing before React loads (no flash). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUI((s) => s.theme);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = resolveTheme(theme, mq.matches);
      document.documentElement.dataset.theme = resolved;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", THEME_COLORS[resolved]);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  return children;
}
