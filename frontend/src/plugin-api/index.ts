/**
 * The Notable plugin API contract.
 *
 * Plugins are ES modules served from the server's plugins directory and
 * loaded at runtime with dynamic import(). A plugin default-exports a
 * `NotablePlugin`; `onload` receives a `NotableAPI` handle scoped to the
 * plugin (everything registered through it is disposed automatically on
 * unload).
 *
 * IMPORTANT for plugin authors: never bundle your own copy of CodeMirror
 * or Yjs — duplicated `@codemirror/state` instances break the editor
 * silently. Mark them external in your build and use `api.modules`.
 *
 * Trust model: plugins run with full app privileges (same origin, no
 * sandbox) — identical to Obsidian. Only install code you trust.
 */
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface Disposable {
  dispose(): void;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Entry module relative to the plugin dir. Default: "main.js". */
  entry?: string;
}

export interface NoteMeta {
  /** Vault-relative path, e.g. "Projects/Plan.md" — the note's identity. */
  path: string;
  /** Filename stem — the title. */
  name: string;
  /** Containing folder ("" = vault root). */
  folder: string;
  /** Last modified, ms since epoch. */
  modified: number;
}

export interface Command {
  /** Globally unique, e.g. "word-count.toggle". */
  id: string;
  /** Human name shown in the command palette. */
  name: string;
  /** Default hotkey, e.g. "Mod-Shift-P" (Mod = Cmd on macOS, Ctrl elsewhere). */
  hotkey?: string;
  /** If present and returns false, the command is hidden/inert. */
  when?: () => boolean;
  run: () => void;
}

export interface PanelSpec {
  id: string;
  title: string;
  /** Mount imperative UI into `el`; return a cleanup function. */
  mount(el: HTMLElement): () => void;
}

export interface SettingsTabSpec {
  id: string;
  title: string;
  mount(el: HTMLElement): () => void;
}

export interface StatusBarItemSpec {
  id: string;
  mount(el: HTMLElement): () => void;
}

export interface AppEvents {
  "note:open": (id: string) => void;
  "note:create": (meta: NoteMeta) => void;
  "note:delete": (id: string) => void;
  /** A new editor view was created (note opened / switched). */
  "editor:ready": (view: EditorView) => void;
  "theme:change": (theme: "light" | "dark") => void;
}

export interface NotableAPI {
  readonly manifest: PluginManifest;

  commands: {
    register(cmd: Command): Disposable;
  };

  hotkeys: {
    /** Bind a key (e.g. "Mod-E") to a registered command id. */
    register(key: string, commandId: string): Disposable;
  };

  editor: {
    /** Add a CodeMirror extension to every editor (live-reconfigured). */
    registerExtension(ext: Extension): Disposable;
    activeView(): EditorView | null;
  };

  workspace: {
    registerSidebarPanel(panel: PanelSpec): Disposable;
    registerRightPanel(panel: PanelSpec): Disposable;
    registerSettingsTab(tab: SettingsTabSpec): Disposable;
    registerStatusBarItem(item: StatusBarItemSpec): Disposable;
    openNote(path: string): void;
    /** Show/hide a registered right panel. */
    toggleRightPanel(id: string): void;
  };

  vault: {
    list(): Promise<NoteMeta[]>;
    create(name?: string, folder?: string): Promise<NoteMeta>;
    /** Path of the open note, or null. */
    activeNoteId(): string | null;
  };

  events: {
    on<K extends keyof AppEvents>(event: K, fn: AppEvents[K]): Disposable;
  };

  /** Per-plugin persistent settings (JSON, stored server-side). */
  settings: {
    load<T>(): Promise<T | null>;
    save<T>(data: T): Promise<void>;
  };

  ui: {
    notice(message: string, durationMs?: number): void;
    confirm(message: string): Promise<boolean>;
  };

  /** Host module instances — consume these instead of bundling your own. */
  modules: {
    codemirror: {
      state: typeof import("@codemirror/state");
      view: typeof import("@codemirror/view");
      language: typeof import("@codemirror/language");
      autocomplete: typeof import("@codemirror/autocomplete");
      commands: typeof import("@codemirror/commands");
      langMarkdown: typeof import("@codemirror/lang-markdown");
    };
    yjs: typeof import("yjs");
  };
}

export interface NotablePlugin {
  onload(api: NotableAPI): void | Promise<void>;
  onunload?(): void | Promise<void>;
}
