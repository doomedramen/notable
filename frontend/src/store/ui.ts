import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePref = "system" | "light" | "dark";

interface UIState {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
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
      partialize: (s) => ({ theme: s.theme, sidebarOpen: s.sidebarOpen }),
    },
  ),
);

export function resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark" {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}
