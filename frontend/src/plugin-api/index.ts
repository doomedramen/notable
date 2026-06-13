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

/** Highest plugin API contract implemented by this Notable build. */
export const CURRENT_PLUGIN_API_VERSION = 4;

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
    }
  | {
      id: string;
      label: string;
      type: "font";
      cssVariable: string;
      default: string;
      /** Curated choices. Omit to allow any font-family string. */
      options?: { label: string; value: string }[];
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
  /**
   * `path` is the right-clicked item. `paths` is the full multi-selection
   * (including `path`), or `[path]` when only one item is selected.
   */
  when?: (path: string, paths: string[]) => boolean;
  run(path: string, paths: string[]): void;
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

/** A cached view of the vault's note and folder tree. */
export interface VaultListing {
  notes: NoteMeta[];
  /** Vault-relative folder paths. The vault root is represented by omission. */
  folders: string[];
}

/**
 * Preferred API v3 input for note creation.
 *
 * `path` gives the caller control of the complete vault-relative filename.
 * Otherwise Notable picks a free `<folder>/<name>.md` path. Supplying initial
 * content is safe for offline-created notes: it is queued with the create
 * mutation and staged for the editor if the note is opened before reconnect.
 */
export interface CreateNoteOptions {
  path?: string;
  name?: string;
  folder?: string;
  content?: string;
}

/**
 * A coherent document snapshot.
 *
 * Revisions are opaque values. Pass the revision back as
 * `expectedRevision` to avoid overwriting changes made since the read.
 */
export interface DocumentSnapshot {
  path: string;
  text: string;
  revision: string;
}

/** A CodeMirror-style UTF-16 text replacement over one document snapshot. */
export interface DocumentTextEdit {
  from: number;
  to: number;
  insert: string;
}

export interface DocumentWriteOptions {
  /**
   * Reject the write if the document no longer has this revision.
   * Omitting it intentionally requests last-write-wins behavior.
   */
  expectedRevision?: string;
}

export interface SearchOptions {
  /** Maximum results to return. Defaults to 20 and is capped at 100. */
  limit?: number;
}

export interface SearchHit {
  path: string;
  name: string;
  /** Plain-text excerpt containing \u0001/\u0002 match delimiters. */
  snippet: string;
}

export interface Backlink {
  sourcePath: string;
  sourceName: string;
  context: string;
}

export interface OutgoingLink {
  /** Target exactly as written inside the wikilink. */
  target: string;
  /** Resolved vault path, or null when the target does not exist. */
  path: string | null;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface TaggedNote {
  path: string;
  name: string;
}

export type PluginAPIErrorCode =
  | "CONFLICT"
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "OFFLINE"
  | "REQUEST_FAILED";

/**
 * Errors raised by asynchronous plugin APIs use this structural shape.
 * Plugins should inspect `code`, rather than matching message text.
 */
export interface PluginAPIError extends Error {
  code: PluginAPIErrorCode;
  status?: number;
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

/** A button or control shown alongside the open note's title. */
export interface NoteToolbarItemSpec {
  id: string;
  /** Mount imperative UI into `el` for the open note at `path`. */
  mount(el: HTMLElement, path: string): () => void;
}

/** A small annotation rendered on a sidebar note row. */
export interface NoteDecoration {
  /** Short text shown after the note's name, e.g. a count or date. */
  badge?: string;
  /** Replaces the note's default file icon. */
  icon?: IconSource;
}

/** Orders two notes for the sidebar list, like `Array.prototype.sort`. */
export type SidebarSortComparator = (a: NoteMeta, b: NoteMeta) => number;

export interface AppEvents {
  "note:open": (id: string) => void;
  "note:create": (meta: NoteMeta) => void;
  "note:delete": (id: string) => void;
  "note:rename": (event: {
    from: string;
    to: string;
    meta: NoteMeta;
  }) => void;
  /**
   * The text changed in this browser. Editor changes include local edits and
   * remote CRDT updates; plugin changes identify writes made through
   * `api.documents`.
   */
  "note:change": (event: {
    path: string;
    source: "editor" | "plugin";
  }) => void;
  "folder:create": (path: string) => void;
  "folder:delete": (path: string) => void;
  "folder:rename": (event: { from: string; to: string }) => void;
  "vault:refresh": (listing: VaultListing) => void;
  /** A new editor view was created (note opened / switched). */
  "editor:ready": (view: EditorView) => void;
  "editor:destroy": (view: EditorView) => void;
  "editor:selection-change": (event: {
    path: string;
    anchor: number;
    head: number;
    from: number;
    to: number;
  }) => void;
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
    registerNoteToolbarItem(item: NoteToolbarItemSpec): Disposable;
    registerNoteContextMenu(item: ContextMenuItemSpec): Disposable;
    registerFolderContextMenu(item: ContextMenuItemSpec): Disposable;
    /** Annotate sidebar note rows with a badge and/or replacement icon. */
    registerNoteDecoration(
      decorate: (note: NoteMeta) => NoteDecoration | null,
    ): Disposable;
    /**
     * Override the sidebar's note ordering within each folder. The most
     * recently registered comparator wins.
     */
    registerSidebarSort(compare: SidebarSortComparator): Disposable;
    openNote(path: string): void;
    /** Navigate to the note-list view for a tag (`/tag/<tag>`). */
    openTag(tag: string): void;
    /** Show/hide a registered right panel. */
    toggleRightPanel(id: string): void;
  };

  vault: {
    list(): Promise<NoteMeta[]>;
    listFolders(): Promise<string[]>;
    refresh(): Promise<VaultListing>;
    stat(path: string): Promise<NoteMeta | null>;
    exists(path: string): Promise<boolean>;
    /** API v3 object form. */
    create(options?: CreateNoteOptions): Promise<NoteMeta>;
    /** Legacy API v1/v2 form retained for compatibility. */
    create(name?: string, folder?: string): Promise<NoteMeta>;
    rename(from: string, to: string): Promise<NoteMeta>;
    trash(path: string): Promise<void>;
    /** Permanently delete a note. Prefer `trash` for user-facing actions. */
    delete(path: string): Promise<void>;
    createFolder(path: string): Promise<void>;
    renameFolder(from: string, to: string): Promise<void>;
    deleteFolder(path: string): Promise<void>;
    /** Path of the open note, or null. */
    activeNoteId(): string | null;
  };

  documents: {
    /**
     * Read the active editor buffer when possible, otherwise the latest
     * server-side CRDT room. Reading an inactive uncached note requires the
     * server and rejects with `OFFLINE` when it is unavailable.
     */
    read(path: string): Promise<DocumentSnapshot>;
    /**
     * Replace a document through the active editor or its server-side Yjs
     * room. The returned snapshot reflects the accepted write.
     */
    replace(
      path: string,
      text: string,
      options?: DocumentWriteOptions,
    ): Promise<DocumentSnapshot>;
    /**
     * Apply non-overlapping edits against one coherent snapshot. Offsets use
     * JavaScript/CodeMirror UTF-16 positions and edits must be sorted.
     */
    applyEdits(
      path: string,
      edits: DocumentTextEdit[],
      options?: DocumentWriteOptions,
    ): Promise<DocumentSnapshot>;
  };

  search: {
    query(text: string, options?: SearchOptions): Promise<SearchHit[]>;
    backlinks(path: string): Promise<Backlink[]>;
    outgoingLinks(path: string): Promise<OutgoingLink[]>;
    tags(): Promise<TagCount[]>;
    notesWithTag(tag: string): Promise<TaggedNote[]>;
  };

  events: {
    on<K extends keyof AppEvents>(event: K, fn: AppEvents[K]): Disposable;
  };

  /** Per-plugin persistent settings (JSON, stored server-side). */
  settings: {
    load<T>(): Promise<T | null>;
    save<T>(data: T): Promise<void>;
  };

  /**
   * Read and write a note's YAML frontmatter block without disturbing its
   * body. Goes through `api.documents`, so writes are Yjs/CRDT-safe.
   */
  frontmatter: {
    /** Parsed frontmatter, or `{}` if the note has none. */
    read(path: string): Promise<Record<string, unknown>>;
    /**
     * Replace the note's frontmatter with `data`, preserving the body.
     * Pass `{}` to remove the frontmatter block entirely.
     */
    write(
      path: string,
      data: Record<string, unknown>,
      options?: DocumentWriteOptions,
    ): Promise<DocumentSnapshot>;
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
