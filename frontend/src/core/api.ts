import * as cmState from "@codemirror/state";
import * as cmView from "@codemirror/view";
import * as cmLanguage from "@codemirror/language";
import * as cmAutocomplete from "@codemirror/autocomplete";
import * as cmCommands from "@codemirror/commands";
import * as cmLangMarkdown from "@codemirror/lang-markdown";
import * as yjs from "yjs";
import type {
  AppEvents,
  Command,
  Disposable,
  NotableAPI,
  PanelSpec,
  PluginManifest,
  SettingsTabSpec,
  StatusBarItemSpec,
} from "../plugin-api";
import { registerTheme } from "./appearance";
import {
  registerIconPack,
  registerIconTheme,
  requestIconPick,
} from "./icons";
import {
  getIconAssignment,
  setIconAssignment,
} from "./icon-assignments";
import { registerCommand } from "./commands";
import { registerHotkey } from "./hotkeys";
import * as events from "./events";
import * as editor from "./editor";
import * as workspace from "./workspace";
import * as vault from "./vault";
import { openNote, openTag } from "./navigation";
import { notice } from "../components/ui/toast";
import { confirm } from "../components/ui/confirm";

/* Host module instances shared with plugins. Plugins must mark these
   external in their builds — a duplicated @codemirror/state instance
   breaks the editor silently. */
const modules: NotableAPI["modules"] = {
  codemirror: {
    state: cmState,
    view: cmView,
    language: cmLanguage,
    autocomplete: cmAutocomplete,
    commands: cmCommands,
    langMarkdown: cmLangMarkdown,
  },
  yjs,
};

/**
 * Build the API handle for one plugin. Every Disposable produced through
 * the handle is tracked in `disposables` so unloading the plugin cleans
 * up everything it registered, even if its own onunload forgets.
 */
export function createPluginAPI(
  manifest: PluginManifest,
  disposables: Disposable[],
): NotableAPI {
  const track = (d: Disposable): Disposable => {
    disposables.push(d);
    return d;
  };
  const settingsKey = `plugin:${manifest.id}`;
  const assetUrl = (path: string): string => {
    const parts = path.split("/");
    if (
      !path ||
      path.startsWith("/") ||
      path.includes("\\") ||
      parts.some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error("plugin asset path must be a safe relative path");
    }
    return `/api/plugins/${encodeURIComponent(manifest.id)}/${parts
      .map(encodeURIComponent)
      .join("/")}?v=${encodeURIComponent(manifest.version)}`;
  };

  return {
    manifest,
    commands: {
      register: (cmd: Command) => track(registerCommand(cmd)),
    },
    hotkeys: {
      register: (key: string, commandId: string) =>
        track(registerHotkey(key, commandId)),
    },
    assets: {
      url: assetUrl,
    },
    appearance: {
      registerTheme: (theme) =>
        track(registerTheme(manifest, theme, assetUrl(theme.stylesheet))),
    },
    icons: {
      registerPack: (pack) => track(registerIconPack(manifest, pack)),
      registerTheme: (theme) => track(registerIconTheme(manifest, theme)),
      pick: requestIconPick,
      getAssignment: getIconAssignment,
      setAssignment: setIconAssignment,
    },
    editor: {
      registerExtension: (ext) => track(editor.registerEditorExtension(ext)),
      activeView: () => editor.activeView(),
    },
    workspace: {
      registerSidebarPanel: (p: PanelSpec) =>
        track(workspace.registerSidebarPanel(p)),
      registerRightPanel: (p: PanelSpec) =>
        track(workspace.registerRightPanel(p)),
      registerSettingsTab: (t: SettingsTabSpec) =>
        track(workspace.registerSettingsTab(t)),
      registerStatusBarItem: (i: StatusBarItemSpec) =>
        track(workspace.registerStatusBarItem(i)),
      registerNoteContextMenu: (i) =>
        track(workspace.registerNoteContextMenu(i)),
      registerFolderContextMenu: (i) =>
        track(workspace.registerFolderContextMenu(i)),
      openNote,
      openTag,
      toggleRightPanel: workspace.toggleRightPanel,
    },
    vault: {
      list: vault.list,
      create: vault.create,
      activeNoteId: vault.activeNoteId,
    },
    events: {
      on: <K extends keyof AppEvents>(event: K, fn: AppEvents[K]) =>
        track(events.on(event, fn)),
    },
    settings: {
      load: async <T,>(): Promise<T | null> => {
        const res = await fetch(`/api/settings/${settingsKey}`);
        if (!res.ok) return null;
        return (await res.json()) as T;
      },
      save: async <T,>(data: T): Promise<void> => {
        await fetch(`/api/settings/${settingsKey}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      },
    },
    ui: {
      notice: (message, durationMs) =>
        notice(message, { duration: durationMs }),
      confirm,
    },
    modules,
  };
}
