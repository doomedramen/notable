import { createStore } from "zustand";
import type {
  ContextMenuItemSpec,
  Disposable,
  NoteDecoration,
  NoteMeta,
  NoteToolbarItemSpec,
  PanelSpec,
  SettingsTabSpec,
  SidebarSortComparator,
  StatusBarItemSpec,
  StatusBarItemRegistration,
  StatusBarItemUpdate,
} from "@/plugin-api";

/* Registries for UI surfaces plugins can contribute to. All mount-based
   (mount(el) => cleanup) so plugins are framework-agnostic; the shell
   renders hosts for whatever is registered. */

interface WorkspaceState {
  sidebarPanels: readonly PanelSpec[];
  rightPanels: readonly PanelSpec[];
  settingsTabs: readonly SettingsTabSpec[];
  statusBarItems: readonly StatusBarItemSpec[];
  noteToolbarItems: readonly NoteToolbarItemSpec[];
  noteContextMenuItems: readonly ContextMenuItemSpec[];
  folderContextMenuItems: readonly ContextMenuItemSpec[];
  noteDecorators: readonly ((note: NoteMeta) => NoteDecoration | null)[];
  sidebarSortComparators: readonly SidebarSortComparator[];
  /** Currently visible right panel (null = hidden). */
  activeRightPanel: string | null;
}

export const workspaceStore = createStore<WorkspaceState>(() => ({
  sidebarPanels: [],
  rightPanels: [],
  settingsTabs: [],
  statusBarItems: [],
  noteToolbarItems: [],
  noteContextMenuItems: [],
  folderContextMenuItems: [],
  noteDecorators: [],
  sidebarSortComparators: [],
  activeRightPanel: null,
}));

function registerIn<T extends { id: string }>(
  key:
    | "sidebarPanels"
    | "rightPanels"
    | "settingsTabs"
    | "statusBarItems"
    | "noteToolbarItems"
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
export function registerStatusBarItem(
  item: StatusBarItemSpec,
): StatusBarItemRegistration {
  let current = item;
  let disposed = false;
  workspaceStore.setState((state) => ({
    statusBarItems: [...state.statusBarItems, current],
  }));

  return {
    update(update: StatusBarItemUpdate) {
      if (disposed || "mount" in current) return;
      const next = { ...current, ...update };
      workspaceStore.setState((state) => ({
        statusBarItems: state.statusBarItems.map((candidate) =>
          candidate === current ? next : candidate,
        ),
      }));
      current = next;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      workspaceStore.setState((state) => ({
        statusBarItems: state.statusBarItems.filter(
          (candidate) => candidate !== current,
        ),
      }));
    },
  };
}
export const registerNoteToolbarItem = (i: NoteToolbarItemSpec) =>
  registerIn("noteToolbarItems", i);
export const registerNoteContextMenu = (i: ContextMenuItemSpec) =>
  registerIn("noteContextMenuItems", i);
export const registerFolderContextMenu = (i: ContextMenuItemSpec) =>
  registerIn("folderContextMenuItems", i);

export function registerNoteDecoration(
  decorate: (note: NoteMeta) => NoteDecoration | null,
): Disposable {
  workspaceStore.setState((s) => ({
    noteDecorators: [...s.noteDecorators, decorate],
  }));
  return {
    dispose: () => {
      workspaceStore.setState((s) => ({
        noteDecorators: s.noteDecorators.filter((d) => d !== decorate),
      }));
    },
  };
}

export function registerSidebarSort(compare: SidebarSortComparator): Disposable {
  workspaceStore.setState((s) => ({
    sidebarSortComparators: [...s.sidebarSortComparators, compare],
  }));
  return {
    dispose: () => {
      workspaceStore.setState((s) => ({
        sidebarSortComparators: s.sidebarSortComparators.filter(
          (c) => c !== compare,
        ),
      }));
    },
  };
}

export function toggleRightPanel(id: string): void {
  workspaceStore.setState((s) => ({
    activeRightPanel: s.activeRightPanel === id ? null : id,
  }));
}
