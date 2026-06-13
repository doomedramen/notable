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
  /** Core plugins may opt into loading on a fresh install. */
  defaultEnabled?: boolean;
  /** Host API contract required by this plugin. Defaults to 1. */
  apiVersion?: number;
  /** Marketplace categories such as "theme" or "icons". */
  categories?: string[];
}

export type AppIconSlot =
  | "add"
  | "appearance"
  | "check"
  | "chevron-down"
  | "clear"
  | "close"
  | "command"
  | "external-link"
  | "file-search"
  | "folder"
  | "folder-add"
  | "icon"
  | "note"
  | "panel"
  | "plugins"
  | "restore"
  | "search"
  | "settings"
  | "sidebar"
  | "tag"
  | "theme-dark"
  | "theme-light"
  | "theme-system"
  | "trash";

export interface IconRef {
  packId: string;
  iconId: string;
}

export type IconSource = AppIconSlot | IconRef;

export interface IconDefinition {
  /** Trusted SVG child markup, e.g. one or more path elements. */
  body?: string;
  /** View box used with body. Defaults to "0 0 24 24". */
  viewBox?: string;
  /** Text glyph alternative, used by emoji-style packs. */
  glyph?: string;
  keywords?: string[];
}

export interface IconPackSpec {
  id: string;
  name: string;
  icons: Record<string, IconDefinition>;
}

export interface IconThemeSpec {
  id: string;
  name: string;
  icons: Partial<Record<AppIconSlot, IconRef>>;
}

export type ThemeControl =
  | {
      id: string;
      label: string;
      type: "color";
      cssVariable: string;
      default: string;
    }
  | {
      id: string;
      label: string;
      type: "number";
      cssVariable: string;
      default: number;
      min: number;
      max: number;
      step?: number;
      unit?: string;
    }
  | {
      id: string;
      label: string;
      type: "toggle";
      cssVariable: string;
      default: boolean;
      trueValue: string;
      falseValue: string;
    }
  | {
      id: string;
      label: string;
      type: "select";
      default: string;
      cssVariable?: string;
      options: {
        label: string;
        value: string;
        variables?: Record<string, string>;
      }[];
    };

export interface ThemeSpec {
  id: string;
  name: string;
  /** Plugin-relative CSS asset path. */
  stylesheet: string;
  controls?: ThemeControl[];
}

export interface IconPickerOptions {
  title?: string;
  current?: IconRef | null;
  allowClear?: boolean;
}

export interface IconTarget {
  kind: "note" | "folder";
  path: string;
}

export interface ContextMenuItemSpec {
  id: string;
  label: string;
  icon?: IconSource;
  when?: (path: string) => boolean;
  run(path: string): void;
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
  icon?: IconSource;
  /** If present and returns false, the command is hidden/inert. */
  when?: () => boolean;
  run: () => void;
}

export interface PanelSpec {
  id: string;
  title: string;
  icon?: IconSource;
  /** Mount imperative UI into `el`; return a cleanup function. */
  mount(el: HTMLElement): () => void;
}

export interface SettingsTabSpec {
  id: string;
  title: string;
  icon?: IconSource;
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

  assets: {
    /** Build a URL for a regular file shipped inside this plugin. */
    url(path: string): string;
  };

  appearance: {
    registerTheme(theme: ThemeSpec): Disposable;
  };

  icons: {
    registerPack(pack: IconPackSpec): Disposable;
    registerTheme(theme: IconThemeSpec): Disposable;
    /**
     * Open the host picker. `undefined` means cancelled and `null` means
     * the user explicitly chose Clear.
     */
    pick(options?: IconPickerOptions): Promise<IconRef | null | undefined>;
    getAssignment(target: IconTarget): IconRef | null;
    setAssignment(target: IconTarget, icon: IconRef | null): Promise<void>;
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
    registerNoteContextMenu(item: ContextMenuItemSpec): Disposable;
    registerFolderContextMenu(item: ContextMenuItemSpec): Disposable;
    openNote(path: string): void;
    /** Navigate to the note-list view for a tag (`/tag/<tag>`). */
    openTag(tag: string): void;
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
