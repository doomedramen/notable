import { useEffect, useRef, type ReactNode } from "react";
import { resolveTheme, useUI } from "../store/ui";
import { emit } from "../core/events";

/** Applies the resolved theme to <html data-theme> and keeps it in sync
    with the OS preference when set to "system". The pre-paint script in
    index.html does the same thing before React loads (no flash). */
const CUSTOM_THEME_LINK_ID = "notable-custom-theme";

/** Mirrors the resolved --background onto <meta name="theme-color"> so the
    OS status bar / task switcher chrome matches the app, including for
    user-installed themes that override --background. */
function syncThemeColor() {
  const background = getComputedStyle(document.documentElement)
    .getPropertyValue("--background")
    .trim();
  if (background) {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", background);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUI((s) => s.theme);
  const customTheme = useUI((s) => s.customTheme);
  const customThemeUrl = useUI((s) => s.customThemeUrl);
  const customThemeVariables = useUI((s) => s.customThemeVariables);
  const editorFontSize = useUI((s) => s.editorFontSize);
  const appliedVariables = useRef<string[]>([]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = resolveTheme(theme, mq.matches);
      document.documentElement.dataset.theme = resolved;
      emit("theme:change", resolved);
      syncThemeColor();
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
      syncThemeColor();
      return;
    }
    const link =
      existing instanceof HTMLLinkElement
        ? existing
        : document.createElement("link");
    link.id = CUSTOM_THEME_LINK_ID;
    link.rel = "stylesheet";
    link.href =
      customThemeUrl ??
      `/api/themes/${encodeURIComponent(customTheme)}.css`;
    // The stylesheet load is async, so --background isn't updated yet
    // when the link is (re)inserted — re-sync once it's applied.
    link.addEventListener("load", syncThemeColor);
    if (!existing) document.head.appendChild(link);
  }, [customTheme, customThemeUrl]);

  useEffect(() => {
    for (const variable of appliedVariables.current) {
      document.documentElement.style.removeProperty(variable);
    }
    const next = Object.entries(customThemeVariables);
    for (const [variable, value] of next) {
      document.documentElement.style.setProperty(variable, value);
    }
    appliedVariables.current = next.map(([variable]) => variable);
    syncThemeColor();
  }, [customThemeVariables]);

  return children;
}
