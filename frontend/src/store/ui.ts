import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IconRef } from "../plugin-api";

export type ThemePref = "system" | "light" | "dark";

interface UIState {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  /** Selected custom theme id (filename without `.css`), or null for none. */
  customTheme: string | null;
  customThemeUrl: string | null;
  customThemeVariables: Record<string, string>;
  themeSettings: Record<string, Record<string, string | number | boolean>>;
  setCustomTheme: (
    id: string | null,
    url?: string | null,
    variables?: Record<string, string>,
  ) => void;
  setThemeSettings: (
    themeSettings: Record<string, Record<string, string | number | boolean>>,
    variables: Record<string, string>,
  ) => void;
  appIconTheme: string | null;
  setAppIconTheme: (id: string | null) => void;
  recentIcons: IconRef[];
  setRecentIcons: (icons: IconRef[]) => void;
  /** Editor content font size in px. */
  editorFontSize: number;
  setEditorFontSize: (size: number) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

/** Mobile-first: the sidebar is an overlay drawer on small screens, so
    it starts closed there; on desktop it starts open. */
const startOpen =
  typeof window === "undefined" ||
  window.matchMedia("(min-width: 768px)").matches;

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
      customTheme: null,
      customThemeUrl: null,
      customThemeVariables: {},
      themeSettings: {},
      setCustomTheme: (
        customTheme,
        customThemeUrl = null,
        customThemeVariables = {},
      ) => set({ customTheme, customThemeUrl, customThemeVariables }),
      setThemeSettings: (themeSettings, customThemeVariables) =>
        set({ themeSettings, customThemeVariables }),
      appIconTheme: null,
      setAppIconTheme: (appIconTheme) => set({ appIconTheme }),
      recentIcons: [],
      setRecentIcons: (recentIcons) => set({ recentIcons }),
      editorFontSize: 14,
      setEditorFontSize: (editorFontSize) => set({ editorFontSize }),
      sidebarOpen: startOpen,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      paletteOpen: false,
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      settingsOpen: false,
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    }),
    // Key is read by the pre-paint script in index.html — keep in sync.
    {
      name: "notable-ui",
      partialize: (s) => ({
        theme: s.theme,
        customTheme: s.customTheme,
        customThemeUrl: s.customThemeUrl,
        customThemeVariables: s.customThemeVariables,
        themeSettings: s.themeSettings,
        appIconTheme: s.appIconTheme,
        recentIcons: s.recentIcons,
        editorFontSize: s.editorFontSize,
        sidebarOpen: s.sidebarOpen,
      }),
    },
  ),
);

export function resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark" {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}
