import {
  Unzip,
  UnzipInflate,
  UnzipPassThrough,
  type UnzipFile,
} from "fflate";
import type {
  ImportConflict,
  StagedImportEntry,
} from "@/store/notes";

export const MAX_IMPORT_ENTRIES = 10_000;
export const MAX_NOTE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 250 * 1024 * 1024;

export interface ImportEntry extends StagedImportEntry {}

export interface ImportSkipped {
  path: string;
  reason:
    | "hidden"
    | "invalid-path"
    | "not-markdown"
    | "invalid-utf8"
    | "note-too-large"
    | "import-too-large"
    | "too-many-entries"
    | "unreadable";
}

export interface ImportPreview {
  rootName: string;
  entries: ImportEntry[];
  folders: string[];
  skipped: ImportSkipped[];
  conflicts: ImportConflict[];
  totalBytes: number;
}

interface FileSystemFileHandleLike {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}

interface FileSystemDirectoryHandleLike {
  kind: "directory";
  name: string;
  values(): AsyncIterableIterator<
    FileSystemFileHandleLike | FileSystemDirectoryHandleLike
  >;
}

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
  }
}

function normalizedPath(path: string): string | null {
  if (
    !path ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path)
  ) {
    return null;
  }
  const parts = path.split("/").filter((part, index, all) => {
    return !(index === all.length - 1 && part === "");
  });
  if (
    parts.length === 0 ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return parts.join("/");
}

function hiddenPath(path: string): boolean {
  return path.split("/").some((part) => part.startsWith("."));
}

function normalizeMarkdownExtension(path: string): string | null {
  if (!/\.md$/i.test(path)) return null;
  return path.replace(/\.md$/i, ".md");
}

function decodeMarkdown(
  path: string,
  bytes: Uint8Array,
  skipped: ImportSkipped[],
): ImportEntry | null {
  try {
    return {
      path,
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      size: bytes.byteLength,
    };
  } catch {
    skipped.push({ path, reason: "invalid-utf8" });
    return null;
  }
}

function addParentFolders(path: string, folders: Set<string>): void {
  const parts = path.split("/");
  parts.pop();
  for (let index = 1; index <= parts.length; index += 1) {
    folders.add(parts.slice(0, index).join("/"));
  }
}

function finalizePreview(
  rootName: string,
  entries: ImportEntry[],
  folders: Set<string>,
  skipped: ImportSkipped[],
): ImportPreview {
  for (const entry of entries) addParentFolders(entry.path, folders);
  return {
    rootName,
    entries,
    folders: [...folders].sort(),
    skipped,
    conflicts: [],
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
  };
}

function duplicatePath(path: string, taken: Set<string>): string {
  if (!taken.has(path)) return path;
  const slash = path.lastIndexOf("/");
  const folder = slash === -1 ? "" : path.slice(0, slash + 1);
  const filename = slash === -1 ? path : path.slice(slash + 1);
  const stem = filename.replace(/\.md$/i, "");
  let index = 1;
  let candidate = `${folder}${stem} ${index}.md`;
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${folder}${stem} ${index}.md`;
  }
  return candidate;
}

export function resolvePreviewConflicts(
  preview: ImportPreview,
  existingPaths: readonly string[],
): ImportPreview {
  const taken = new Set(existingPaths);
  const conflicts: ImportConflict[] = [];
  const entries = preview.entries.map((entry) => {
    const path = duplicatePath(entry.path, taken);
    taken.add(path);
    if (path !== entry.path) conflicts.push({ from: entry.path, to: path });
    return { ...entry, path };
  });
  return { ...preview, entries, conflicts };
}

async function readCandidate(
  displayPath: string,
  file: File,
  state: {
    entries: ImportEntry[];
    skipped: ImportSkipped[];
    totalBytes: number;
    count: number;
  },
): Promise<void> {
  state.count += 1;
  if (state.count > MAX_IMPORT_ENTRIES) {
    state.skipped.push({ path: displayPath, reason: "too-many-entries" });
    return;
  }
  const path = normalizedPath(displayPath);
  if (!path) {
    state.skipped.push({ path: displayPath, reason: "invalid-path" });
    return;
  }
  if (hiddenPath(path)) {
    state.skipped.push({ path, reason: "hidden" });
    return;
  }
  const markdownPath = normalizeMarkdownExtension(path);
  if (!markdownPath) {
    state.skipped.push({ path, reason: "not-markdown" });
    return;
  }
  if (file.size > MAX_NOTE_BYTES) {
    state.skipped.push({ path, reason: "note-too-large" });
    return;
  }
  if (state.totalBytes + file.size > MAX_IMPORT_BYTES) {
    state.skipped.push({ path, reason: "import-too-large" });
    return;
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entry = decodeMarkdown(markdownPath, bytes, state.skipped);
    if (entry) {
      state.entries.push(entry);
      state.totalBytes += entry.size;
    }
  } catch {
    state.skipped.push({ path, reason: "unreadable" });
  }
}

export async function previewDirectoryFiles(
  files: Iterable<File>,
): Promise<ImportPreview> {
  const list = [...files];
  const firstPath = list[0]?.webkitRelativePath || list[0]?.name || "Import";
  const rootName = firstPath.split("/")[0] || "Import";
  const state = {
    entries: [] as ImportEntry[],
    skipped: [] as ImportSkipped[],
    totalBytes: 0,
    count: 0,
  };
  for (const file of list) {
    const path = file.webkitRelativePath || `${rootName}/${file.name}`;
    await readCandidate(path, file, state);
  }
  return finalizePreview(rootName, state.entries, new Set(), state.skipped);
}

async function walkDirectory(
  handle: FileSystemDirectoryHandleLike,
  prefix: string,
  state: {
    entries: ImportEntry[];
    folders: Set<string>;
    skipped: ImportSkipped[];
    totalBytes: number;
    count: number;
  },
): Promise<void> {
  state.folders.add(prefix);
  for await (const child of handle.values()) {
    const path = `${prefix}/${child.name}`;
    if (child.kind === "directory") {
      state.count += 1;
      if (state.count > MAX_IMPORT_ENTRIES) {
        state.skipped.push({ path, reason: "too-many-entries" });
        continue;
      }
      const normalized = normalizedPath(path);
      if (!normalized) {
        state.skipped.push({ path, reason: "invalid-path" });
      } else if (hiddenPath(normalized)) {
        state.skipped.push({ path: normalized, reason: "hidden" });
      } else {
        await walkDirectory(child, normalized, state);
      }
    } else {
      try {
        await readCandidate(path, await child.getFile(), state);
      } catch {
        state.skipped.push({ path, reason: "unreadable" });
      }
    }
  }
}

export async function previewDirectoryPicker(): Promise<ImportPreview> {
  if (!window.showDirectoryPicker) {
    throw new Error("Directory picker is not supported.");
  }
  const handle = await window.showDirectoryPicker();
  const root = normalizedPath(handle.name);
  if (!root || hiddenPath(root)) {
    throw new Error("The selected folder name is not a valid vault path.");
  }
  const state = {
    entries: [] as ImportEntry[],
    folders: new Set<string>(),
    skipped: [] as ImportSkipped[],
    totalBytes: 0,
    count: 0,
  };
  await walkDirectory(handle, root, state);
  return finalizePreview(
    root,
    state.entries,
    state.folders,
    state.skipped,
  );
}

function zipRootName(filename: string): string {
  const stem = filename.replace(/\.zip$/i, "").trim() || "Import";
  const cleaned = stem.replace(/[\\/:*?"<>|#%]/g, " ").trim();
  return cleaned && !cleaned.startsWith(".") ? cleaned : "Import";
}

function commonZipRoot(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const roots = paths.map((path) => path.split("/"));
  const first = roots[0][0];
  return first && roots.every((parts) => parts.length > 1 && parts[0] === first)
    ? first
    : null;
}

export async function previewZip(file: File): Promise<ImportPreview> {
  const compressed = new Uint8Array(await file.arrayBuffer());
  const rawEntries: ImportEntry[] = [];
  const rawFolders = new Set<string>();
  const skipped: ImportSkipped[] = [];
  let count = 0;
  let extractedBytes = 0;

  await new Promise<void>((resolve, reject) => {
    let active = 0;
    let pushed = false;
    const finish = () => {
      if (pushed && active === 0) resolve();
    };
    const unzip = new Unzip((entry: UnzipFile) => {
      count += 1;
      const original = entry.name;
      if (count > MAX_IMPORT_ENTRIES) {
        skipped.push({ path: original, reason: "too-many-entries" });
        return;
      }
      const path = normalizedPath(original);
      if (!path) {
        skipped.push({ path: original, reason: "invalid-path" });
        return;
      }
      if (hiddenPath(path)) {
        skipped.push({ path, reason: "hidden" });
        return;
      }
      if (original.endsWith("/")) {
        rawFolders.add(path);
        return;
      }
      const markdownPath = normalizeMarkdownExtension(path);
      if (!markdownPath) {
        skipped.push({ path, reason: "not-markdown" });
        return;
      }
      if (
        entry.originalSize !== undefined &&
        entry.originalSize > MAX_NOTE_BYTES
      ) {
        skipped.push({ path, reason: "note-too-large" });
        return;
      }
      if (
        entry.originalSize !== undefined &&
        extractedBytes + entry.originalSize > MAX_IMPORT_BYTES
      ) {
        skipped.push({ path, reason: "import-too-large" });
        return;
      }

      active += 1;
      const chunks: Uint8Array[] = [];
      let size = 0;
      let rejected = false;
      let completed = false;
      entry.ondata = (error, data, final) => {
        if (completed) return;
        if (error) {
          rejected = true;
          skipped.push({ path, reason: "unreadable" });
        } else if (!rejected) {
          size += data.byteLength;
          if (size > MAX_NOTE_BYTES) {
            rejected = true;
            skipped.push({ path, reason: "note-too-large" });
            entry.terminate();
          } else if (extractedBytes + size > MAX_IMPORT_BYTES) {
            rejected = true;
            skipped.push({ path, reason: "import-too-large" });
            entry.terminate();
          } else {
            chunks.push(data);
          }
        }
        if (final || rejected || error) {
          completed = true;
          if (!rejected && !error) {
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            const decoded = decodeMarkdown(markdownPath, bytes, skipped);
            if (decoded) {
              rawEntries.push(decoded);
              extractedBytes += decoded.size;
            }
          }
          active -= 1;
          finish();
        }
      };
      try {
        entry.start();
      } catch {
        active -= 1;
        skipped.push({ path, reason: "unreadable" });
      }
    });
    unzip.register(UnzipInflate);
    unzip.register(UnzipPassThrough);
    try {
      unzip.push(compressed, true);
      pushed = true;
      finish();
    } catch (error) {
      reject(error);
    }
  });

  const sourcePaths = [
    ...rawEntries.map((entry) => entry.path),
    ...rawFolders,
  ];
  const commonRoot = commonZipRoot(sourcePaths);
  const rootName = commonRoot ?? zipRootName(file.name);
  const prefix = commonRoot ? "" : `${rootName}/`;
  const entries = rawEntries.map((entry) => ({
    ...entry,
    path: `${prefix}${entry.path}`,
  }));
  const folders = new Set(
    [...rawFolders].map((folder) => `${prefix}${folder}`),
  );
  if (!commonRoot) folders.add(rootName);
  return finalizePreview(rootName, entries, folders, skipped);
}
