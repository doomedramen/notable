import { createStore } from "zustand";
import type {
  ContextMenuItemSpec,
  Disposable,
  PanelSpec,
  SettingsTabSpec,
  StatusBarItemSpec,
} from "../plugin-api";

/* Registries for UI surfaces plugins can contribute to. All mount-based
   (mount(el) => cleanup) so plugins are framework-agnostic; the shell
   renders hosts for whatever is registered. */

interface WorkspaceState {
  sidebarPanels: readonly PanelSpec[];
  rightPanels: readonly PanelSpec[];
  settingsTabs: readonly SettingsTabSpec[];
  statusBarItems: readonly StatusBarItemSpec[];
  noteContextMenuItems: readonly ContextMenuItemSpec[];
  folderContextMenuItems: readonly ContextMenuItemSpec[];
  /** Currently visible right panel (null = hidden). */
  activeRightPanel: string | null;
}

export const workspaceStore = createStore<WorkspaceState>(() => ({
  sidebarPanels: [],
  rightPanels: [],
  settingsTabs: [],
  statusBarItems: [],
  noteContextMenuItems: [],
  folderContextMenuItems: [],
  activeRightPanel: null,
}));

function registerIn<T extends { id: string }>(
  key:
    | "sidebarPanels"
    | "rightPanels"
    | "settingsTabs"
    | "statusBarItems"
    | "noteContextMenuItems"
    | "folderContextMenuItems",
  item: T,
): Disposable {
  workspaceStore.setState((s) => ({
    [key]: [...(s[key] as unknown as readonly T[]), item],
  }));
  return {
    dispose: () => {
      workspaceStore.setState((s) => {
        const next: Partial<WorkspaceState> = {
          [key]: (s[key] as unknown as readonly T[]).filter(
            (i) => i !== item,
          ) as never,
        };
        if (key === "rightPanels" && s.activeRightPanel === item.id) {
          next.activeRightPanel = null;
        }
        return next;
      });
    },
  };
}

export const registerSidebarPanel = (p: PanelSpec) =>
  registerIn("sidebarPanels", p);
export const registerRightPanel = (p: PanelSpec) =>
  registerIn("rightPanels", p);
export const registerSettingsTab = (t: SettingsTabSpec) =>
  registerIn("settingsTabs", t);
export const registerStatusBarItem = (i: StatusBarItemSpec) =>
  registerIn("statusBarItems", i);
export const registerNoteContextMenu = (i: ContextMenuItemSpec) =>
  registerIn("noteContextMenuItems", i);
export const registerFolderContextMenu = (i: ContextMenuItemSpec) =>
  registerIn("folderContextMenuItems", i);

export function toggleRightPanel(id: string): void {
  workspaceStore.setState((s) => ({
    activeRightPanel: s.activeRightPanel === id ? null : id,
  }));
}
