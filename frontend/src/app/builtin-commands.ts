import { registerCommand } from "@/core/commands";
import { useUI } from "@/store/ui";
import { isMobileViewport } from "@/lib/viewport";

/* Core commands, registered through the same registry plugins use. */

let registered = false;

export function registerBuiltinCommands(): void {
  if (registered) return;
  registered = true;

  registerCommand({
    id: "palette.open",
    name: "Open command palette",
    hotkey: "Mod-k",
    run: () => useUI.getState().setPaletteOpen(true),
  });

  registerCommand({
    id: "sidebar.toggle",
    name: "Toggle sidebar",
    hotkey: "Mod-\\",
    run: () => {
      const state = useUI.getState();
      if (isMobileViewport()) {
        state.toggleMobileSidebar();
      } else {
        state.toggleSidebar();
      }
    },
  });

  registerCommand({
    id: "settings.open",
    name: "Open settings",
    hotkey: "Mod-,",
    run: () => useUI.getState().setSettingsOpen(true),
  });

  registerCommand({
    id: "vault.import",
    name: "Import folder or ZIP",
    run: () => useUI.getState().setImportOpen(true),
  });

  registerCommand({
    id: "editor.toggle-mode",
    name: "Toggle Rich/Source Mode",
    hotkey: "Mod-Shift-e",
    run: () => {
      const { editorMode, setEditorMode } = useUI.getState();
      setEditorMode(editorMode === "rich" ? "source" : "rich");
    },
  });

  registerCommand({
    id: "theme.cycle",
    name: "Cycle theme (light / dark / system)",
    run: () => {
      const order = ["light", "dark", "system"] as const;
      const { theme, setTheme } = useUI.getState();
      setTheme(order[(order.indexOf(theme) + 1) % order.length]!);
    },
  });
}
