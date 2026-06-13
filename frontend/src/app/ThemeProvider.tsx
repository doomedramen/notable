import { useEffect, type ReactNode } from "react";
import { resolveTheme, useUI } from "../store/ui";

const THEME_COLORS = { light: "#ffffff", dark: "#1e1e2e" } as const;

/** Applies the resolved theme to <html data-theme> and keeps it in sync
    with the OS preference when set to "system". The pre-paint script in
    index.html does the same thing before React loads (no flash). */
const CUSTOM_THEME_LINK_ID = "notable-custom-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUI((s) => s.theme);
  const customTheme = useUI((s) => s.customTheme);
  const editorFontSize = useUI((s) => s.editorFontSize);

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

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--editor-font-size",
      `${editorFontSize}px`,
    );
  }, [editorFontSize]);

  useEffect(() => {
    const existing = document.getElementById(CUSTOM_THEME_LINK_ID);
    if (!customTheme) {
      existing?.remove();
      return;
    }
    const link =
      existing instanceof HTMLLinkElement
        ? existing
        : document.createElement("link");
    link.id = CUSTOM_THEME_LINK_ID;
    link.rel = "stylesheet";
    link.href = `/api/themes/${encodeURIComponent(customTheme)}.css`;
    if (!existing) document.head.appendChild(link);
  }, [customTheme]);

  return children;
}
