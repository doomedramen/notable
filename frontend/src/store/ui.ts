import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IconRef } from "@/plugin-api";
import { isMobileViewport } from "@/lib/viewport";

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
  hapticsEnabled: boolean;
  setHapticsEnabled: (enabled: boolean) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  toggleMobileSidebar: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  importOpen: boolean;
  setImportOpen: (open: boolean) => void;
  collapsedFolders: string[];
  toggleFolderCollapsed: (folder: string) => void;
  recentNotePaths: string[];
  recordRecentNote: (path: string) => void;
  recentCommandIds: string[];
  recordRecentCommand: (id: string) => void;
}

/** Mobile-first: the sidebar is an overlay drawer on small screens, so
    it starts closed there; on desktop it starts open. */
const startOpen = !isMobileViewport();

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
      hapticsEnabled: true,
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
      sidebarOpen: startOpen,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      mobileSidebarOpen: false,
      setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
      toggleMobileSidebar: () =>
        set((state) => ({
          mobileSidebarOpen: !state.mobileSidebarOpen,
        })),
      paletteOpen: false,
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      settingsOpen: false,
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      importOpen: false,
      setImportOpen: (importOpen) => set({ importOpen }),
      collapsedFolders: [],
      toggleFolderCollapsed: (folder) =>
        set((state) => ({
          collapsedFolders: state.collapsedFolders.includes(folder)
            ? state.collapsedFolders.filter((item) => item !== folder)
            : [...state.collapsedFolders, folder],
        })),
      recentNotePaths: [],
      recordRecentNote: (path) =>
        set((state) => ({
          recentNotePaths: [
            path,
            ...state.recentNotePaths.filter((item) => item !== path),
          ].slice(0, 12),
        })),
      recentCommandIds: [],
      recordRecentCommand: (id) =>
        set((state) => ({
          recentCommandIds: [
            id,
            ...state.recentCommandIds.filter((item) => item !== id),
          ].slice(0, 12),
        })),
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
        hapticsEnabled: s.hapticsEnabled,
        sidebarOpen: s.sidebarOpen,
        collapsedFolders: s.collapsedFolders,
        recentNotePaths: s.recentNotePaths,
        recentCommandIds: s.recentCommandIds,
      }),
    },
  ),
);

export function resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark" {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}
