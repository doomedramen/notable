import { registerCommand } from "../core/commands";
import { openNote } from "../core/navigation";
import * as vault from "../core/vault";
import { useUI } from "../store/ui";

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
    id: "notes.new",
    name: "New note",
    hotkey: "Mod-Alt-n",
    run: () => {
      void vault.create().then((meta) => openNote(meta.path));
    },
  });

  registerCommand({
    id: "sidebar.toggle",
    name: "Toggle sidebar",
    hotkey: "Mod-\\",
    run: () => useUI.getState().toggleSidebar(),
  });

  registerCommand({
    id: "settings.open",
    name: "Open settings",
    hotkey: "Mod-,",
    run: () => useUI.getState().setSettingsOpen(true),
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
