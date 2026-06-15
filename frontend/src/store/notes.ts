// Offline-first vault metadata and mutation queue.
//
// The vault listing and queued operations live in IndexedDB. Note bodies for
// offline creates live in a separate IndexedDB object store so folder imports
// are not constrained by localStorage's small quota.
import {
  moveCachedIconAssignment,
  removeCachedFolderTree,
  removeCachedIconAssignment,
} from "@/core/icon-assignments";
import { clearPendingContent, peekPendingContent } from "@/core/pending-content";
import { dirtyContent, isDirty, moveDirty } from "@/sync/dirty";
import { getKV, getStagedContent, mutateMeta, setKV } from "./vault-db";

export interface NoteMeta {
  /** Vault-relative path — the note's identity. */
  path: string;
  /** Filename stem — the title. */
  name: string;
  /** Containing folder ("" = vault root). */
  folder: string;
  /** Last modified, ms since epoch. */
  modified: number;
}

export interface VaultListing {
  notes: NoteMeta[];
  folders: string[];
}

interface PendingBase {
  id?: string;
}

type Pending =
  | (PendingBase & {
      kind: "create";
      path: string;
      /** Legacy v1 queues embedded the body directly. */
      content?: string;
      contentKey?: string;
      source?: "note" | "import";
      serverCreated?: boolean;
    })
  | (PendingBase & { kind: "delete"; path: string })
  | (PendingBase & { kind: "rename"; from: string; to: string })
  | (PendingBase & { kind: "mkdir"; path: string });
type CreatePending = Extract<Pending, { kind: "create" }>;

export interface StagedImportEntry {
  path: string;
  content: string;
  size: number;
}

export interface ImportConflict {
  from: string;
  to: string;
}

export interface StageImportResult {
  listing: VaultListing;
  notes: NoteMeta[];
  folders: string[];
  conflicts: ImportConflict[];
}

export interface FlushResult {
  completed: number;
  remaining: number;
  pathChanges: ImportConflict[];
}

const EMPTY: VaultListing = { notes: [], folders: [] };
const REPLAY_CONCURRENCY = 4;

function queueId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function asListing(value: unknown): VaultListing {
  if (!value || typeof value !== "object") return EMPTY;
  const candidate = value as Partial<VaultListing>;
  return {
    notes: Array.isArray(candidate.notes) ? candidate.notes : [],
    folders: Array.isArray(candidate.folders) ? candidate.folders : [],
  };
}

function asQueue(value: unknown[]): Pending[] {
  return value as Pending[];
}

/** Encode a vault path for use in a URL (keeps "/" separators). */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function buildMeta(path: string, modified = Date.now()): NoteMeta {
  const slash = path.lastIndexOf("/");
  const file = slash === -1 ? path : path.slice(slash + 1);
  return {
    path,
    name: file.replace(/\.md$/i, ""),
    folder: slash === -1 ? "" : path.slice(0, slash),
    modified,
  };
}

function validateSegments(path: string, allowTrash = false): void {
  const parts = path.split("/");
  if (
    !path ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    parts.some(
      (part, index) =>
        !part ||
        part === "." ||
        part === ".." ||
        (part.startsWith(".") && !(allowTrash && index === 0 && part === ".trash")),
    )
  ) {
    throw new Error(`Invalid vault path: ${path}`);
  }
}

/** Validate the canonical slash-separated path shape used by the API. */
export function validateNotePath(path: string): void {
  validateSegments(path);
  if (!path.endsWith(".md")) {
    throw new Error(`Note paths must end in .md: ${path}`);
  }
}

/** Validate a non-root folder path. */
export function validateFolderPath(path: string): void {
  validateSegments(path);
}

function validateNoteOrTrashPath(path: string): void {
  validateSegments(path, true);
  if (!path.endsWith(".md")) {
    throw new Error(`Note paths must end in .md: ${path}`);
  }
}

/** Keep client-side path selection identical to the Rust vault handler. */
function sanitizeName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|#%]/g, " ").trim();
  if (!cleaned || cleaned.startsWith(".")) {
    throw new Error("Note name must contain a visible character.");
  }
  return cleaned;
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

function parentFolders(path: string): string[] {
  const parts = path.split("/");
  parts.pop();
  const folders: string[] = [];
  for (let index = 1; index <= parts.length; index += 1) {
    folders.push(parts.slice(0, index).join("/"));
  }
  return folders;
}

async function cachedState(): Promise<{
  listing: VaultListing;
  queue: Pending[];
}> {
  const [listing, queue] = await Promise.all([
    getKV<VaultListing>("vault"),
    getKV<Pending[]>("queue"),
  ]);
  return { listing: listing ?? EMPTY, queue: queue ?? [] };
}

/**
 * Reconcile the authoritative server listing with operations still sitting in
 * the offline queue, so the UI reflects offline mutations even when a refresh
 * races ahead of the queue flush. Every queued op must be represented here:
 * a `create`/`rename` target is re-added, and a `delete`/`rename` source is
 * removed — otherwise an offline-deleted or trashed note (trash is a rename
 * into `.trash/`) resurfaces the moment the server is reachable again.
 */
export function mergeServerListing(
  server: VaultListing,
  local: VaultListing,
  queue: Pending[],
): VaultListing {
  // Paths the queue will remove from / add to the server's current view.
  const removed = new Set<string>();
  const added = new Set<string>();
  for (const op of queue) {
    if (op.kind === "create") added.add(op.path);
    else if (op.kind === "delete") removed.add(op.path);
    else if (op.kind === "rename") {
      removed.add(op.from);
      added.add(op.to);
    }
  }

  const localByPath = new Map(local.notes.map((note) => [note.path, note]));
  const notes: NoteMeta[] = [];
  const seen = new Set<string>();
  for (const note of server.notes) {
    if (removed.has(note.path)) continue;
    notes.push(note);
    seen.add(note.path);
  }
  // Re-add optimistic notes the server doesn't know about yet. Trashed notes
  // (rename targets under `.trash/`) are intentionally excluded from listings.
  for (const path of added) {
    if (seen.has(path) || path.startsWith(".trash/")) continue;
    const meta = localByPath.get(path);
    if (meta) {
      notes.unshift(meta);
      seen.add(path);
    }
  }

  const folders = new Set(server.folders);
  for (const op of queue) {
    if (op.kind === "mkdir") folders.add(op.path);
    if (op.kind === "create") {
      for (const folder of parentFolders(op.path)) folders.add(folder);
    }
  }
  return { notes, folders: [...folders].sort() };
}

export async function listVault(): Promise<VaultListing> {
  const local = await cachedState();
  try {
    const response = await fetch("/api/notes");
    if (!response.ok) throw new Error();
    const server = (await response.json()) as VaultListing;
    const listing = mergeServerListing(server, local.listing, local.queue);
    await setKV("vault", listing);
    return listing;
  } catch {
    return local.listing;
  }
}

async function freePath(name: string, folder: string): Promise<string> {
  const safeName = sanitizeName(name);
  if (folder) validateFolderPath(folder);
  const listing = (await getKV<VaultListing>("vault")) ?? EMPTY;
  const prefix = folder ? `${folder}/` : "";
  return duplicatePath(`${prefix}${safeName}.md`, new Set(listing.notes.map((note) => note.path)));
}

export async function createNote(
  name = "Untitled",
  folder = "",
  content = "",
  requestedPath?: string,
): Promise<NoteMeta> {
  const path = requestedPath ?? (await freePath(name, folder));
  validateNotePath(path);
  const meta = buildMeta(path);

  await mutateMeta((rawVault, rawQueue) => {
    const listing = asListing(rawVault);
    if (listing.notes.some((note) => note.path === path)) {
      throw new Error(`A note already exists at ${path}`);
    }
    return {
      vault: { ...listing, notes: [meta, ...listing.notes] },
      queue: rawQueue,
      result: undefined,
    };
  });

  try {
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    if (!response.ok) {
      throw new Error(`Could not create note (${response.status}).`);
    }
  } catch (error) {
    if (!(error instanceof TypeError)) {
      await mutateMeta((rawVault, rawQueue) => {
        const listing = asListing(rawVault);
        return {
          vault: {
            ...listing,
            notes: listing.notes.filter((note) => note.path !== path),
          },
          queue: rawQueue,
          result: undefined,
        };
      });
      throw error;
    }
    await mutateMeta((rawVault, rawQueue) => ({
      vault: asListing(rawVault),
      queue: [
        ...asQueue(rawQueue),
        {
          id: queueId(),
          kind: "create",
          path,
          contentKey: path,
          source: "note",
        } satisfies Pending,
      ],
      contentPuts: content ? [{ key: path, content }] : [],
      result: undefined,
    }));
  }
  return meta;
}

export async function deleteNote(path: string): Promise<void> {
  await mutateMeta((rawVault, rawQueue) => {
    const listing = asListing(rawVault);
    return {
      vault: {
        ...listing,
        notes: listing.notes.filter((note) => note.path !== path),
      },
      queue: rawQueue,
      result: undefined,
    };
  });
  removeCachedIconAssignment("note", path);
  try {
    const response = await fetch(`/api/notes/${encodePath(path)}`, {
      method: "DELETE",
    });
    if (!response.ok && response.status >= 500) throw new Error();
  } catch {
    await enqueue({ id: queueId(), kind: "delete", path });
  }
}

export async function renameNote(from: string, to: string): Promise<NoteMeta> {
  validateNoteOrTrashPath(from);
  validateNoteOrTrashPath(to);
  const meta = buildMeta(to);
  let before = EMPTY;
  await mutateMeta((rawVault, rawQueue) => {
    before = asListing(rawVault);
    return {
      vault: {
        ...before,
        notes: before.notes.map((note) => (note.path === from ? meta : note)),
      },
      queue: rawQueue,
      result: undefined,
    };
  });
  moveCachedIconAssignment("note", from, to);
  try {
    const response = await fetch(`/api/notes/${encodePath(from)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_path: to }),
    });
    if (!response.ok) {
      await setKV("vault", before);
      moveCachedIconAssignment("note", to, from);
      throw new Error(
        response.status === 409
          ? `A note already exists at ${to}`
          : `Could not rename note (${response.status}).`,
      );
    }
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    await enqueue({ id: queueId(), kind: "rename", from, to });
  }
  return meta;
}

export interface TrashedNote {
  path: string;
  original_path: string;
  name: string;
  deleted_at: number;
}

export async function trashNote(path: string): Promise<void> {
  await renameNote(path, `.trash/${path}`);
}

export async function restoreFromTrash(note: TrashedNote): Promise<void> {
  await renameNote(note.path, note.original_path);
}

export async function listTrash(): Promise<TrashedNote[]> {
  try {
    const response = await fetch("/api/trash");
    if (!response.ok) throw new Error();
    return await response.json();
  } catch {
    return [];
  }
}

export async function deleteFromTrash(path: string): Promise<void> {
  const response = await fetch(`/api/notes/${encodePath(path)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error();
  removeCachedIconAssignment("note", path);
}

export async function createFolder(path: string): Promise<void> {
  validateFolderPath(path);
  let before = EMPTY;
  await mutateMeta((rawVault, rawQueue) => {
    before = asListing(rawVault);
    return {
      vault: before.folders.includes(path)
        ? before
        : { ...before, folders: [...before.folders, path].sort() },
      queue: rawQueue,
      result: undefined,
    };
  });
  try {
    const response = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!response.ok) {
      await setKV("vault", before);
      throw new Error(`Could not create folder (${response.status}).`);
    }
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    await enqueue({ id: queueId(), kind: "mkdir", path });
  }
}

export async function deleteFolder(path: string): Promise<void> {
  validateFolderPath(path);
  const response = await fetch(`/api/folders/${encodePath(path)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(response.status === 409 ? "not-empty" : "failed");
  }
  await mutateMeta((rawVault, rawQueue) => {
    const listing = asListing(rawVault);
    return {
      vault: {
        ...listing,
        folders: listing.folders.filter(
          (folder) => folder !== path && !folder.startsWith(`${path}/`),
        ),
      },
      queue: rawQueue,
      result: undefined,
    };
  });
  removeCachedFolderTree(path);
}

export async function stageImport(
  entries: readonly StagedImportEntry[],
  requestedFolders: readonly string[],
): Promise<StageImportResult> {
  return mutateMeta((rawVault, rawQueue) => {
    const listing = asListing(rawVault);
    const queue = asQueue(rawQueue);
    const taken = new Set(listing.notes.map((note) => note.path));
    const notes: NoteMeta[] = [];
    const conflicts: ImportConflict[] = [];
    const contentPuts: Array<{ key: string; content: string }> = [];
    const pendingCreates: Pending[] = [];
    const folderSet = new Set(listing.folders);
    const queuedFolders = new Set(queue.filter((op) => op.kind === "mkdir").map((op) => op.path));

    for (const entry of entries) {
      validateNotePath(entry.path);
      const path = duplicatePath(entry.path, taken);
      taken.add(path);
      if (path !== entry.path) conflicts.push({ from: entry.path, to: path });
      notes.push(buildMeta(path));
      contentPuts.push({ key: path, content: entry.content });
      pendingCreates.push({
        id: queueId(),
        kind: "create",
        path,
        contentKey: path,
        source: "import",
      });
      for (const folder of parentFolders(path)) folderSet.add(folder);
    }

    for (const folder of requestedFolders) {
      validateFolderPath(folder);
      const parts = folder.split("/");
      for (let index = 1; index <= parts.length; index += 1) {
        folderSet.add(parts.slice(0, index).join("/"));
      }
    }

    const newFolders = [...folderSet].filter((folder) => !listing.folders.includes(folder));
    for (const folder of newFolders) {
      if (!queuedFolders.has(folder)) {
        queue.push({ id: queueId(), kind: "mkdir", path: folder });
      }
    }
    const nextQueue = [...queue, ...pendingCreates];

    const nextListing = {
      notes: [...notes, ...listing.notes],
      folders: [...folderSet].sort(),
    };
    return {
      vault: nextListing,
      queue: nextQueue,
      contentPuts,
      result: {
        listing: nextListing,
        notes,
        folders: newFolders,
        conflicts,
      },
    };
  });
}

async function enqueue(operation: Pending): Promise<void> {
  await mutateMeta((rawVault, rawQueue) => ({
    vault: asListing(rawVault),
    queue: [...asQueue(rawQueue), operation],
    result: undefined,
  }));
}

async function ensureQueueIds(): Promise<Pending[]> {
  return mutateMeta((rawVault, rawQueue) => {
    const queue = asQueue(rawQueue).map((operation) => ({
      ...operation,
      id: operation.id ?? queueId(),
    }));
    return {
      vault: asListing(rawVault),
      queue,
      result: queue,
    };
  });
}

async function removeQueued(id: string): Promise<void> {
  await mutateMeta((rawVault, rawQueue) => ({
    vault: asListing(rawVault),
    queue: asQueue(rawQueue).filter((operation) => operation.id !== id),
    result: undefined,
  }));
}

async function markServerCreated(id: string): Promise<void> {
  await mutateMeta((rawVault, rawQueue) => ({
    vault: asListing(rawVault),
    queue: asQueue(rawQueue).map((operation) =>
      operation.id === id && operation.kind === "create"
        ? { ...operation, serverCreated: true }
        : operation,
    ),
    result: undefined,
  }));
}

async function reconcileImportConflicts(server: VaultListing): Promise<ImportConflict[]> {
  const { queue } = await cachedState();
  const candidates = queue.filter(
    (operation): operation is CreatePending =>
      operation.kind === "create" && operation.source === "import" && !operation.serverCreated,
  );
  const staged = new Map<string, string>();
  for (const operation of candidates) {
    const content =
      (await getStagedContent(operation.contentKey ?? operation.path)) ??
      dirtyContent(operation.path);
    if (content !== null && content !== undefined) {
      staged.set(operation.path, content);
    }
  }

  const changes = await mutateMeta((rawVault, rawQueue) => {
    const current = asListing(rawVault);
    const serverPaths = new Set(server.notes.map((note) => note.path));
    const taken = new Set([...serverPaths, ...current.notes.map((note) => note.path)]);
    const conflicts: ImportConflict[] = [];
    const replacements = new Map<string, string>();

    const nextQueue = asQueue(rawQueue).map((operation) => {
      if (
        operation.kind !== "create" ||
        operation.source !== "import" ||
        operation.serverCreated ||
        !serverPaths.has(operation.path)
      ) {
        return operation;
      }
      const nextPath = duplicatePath(operation.path, taken);
      taken.add(nextPath);
      serverPaths.add(nextPath);
      replacements.set(operation.path, nextPath);
      conflicts.push({ from: operation.path, to: nextPath });
      return {
        ...operation,
        path: nextPath,
        contentKey: nextPath,
      };
    });

    if (conflicts.length === 0) {
      return {
        vault: current,
        queue: nextQueue,
        result: conflicts,
      };
    }

    const nextNotes = current.notes.map((note) => {
      const replacement = replacements.get(note.path);
      return replacement ? buildMeta(replacement, note.modified) : note;
    });
    const contentPuts = conflicts.flatMap(({ from, to }) => {
      const content = staged.get(from);
      return content === undefined ? [] : [{ key: to, content }];
    });
    return {
      vault: { ...current, notes: nextNotes },
      queue: nextQueue,
      contentPuts,
      contentDeletes: conflicts.map((conflict) => conflict.from),
      result: conflicts,
    };
  });

  for (const change of changes) {
    moveDirty(change.from, change.to);
    window.dispatchEvent(new CustomEvent("notable:pending-path-renamed", { detail: change }));
  }
  return changes;
}

async function processOperation(operation: Pending): Promise<boolean> {
  if (!operation.id) return false;
  try {
    if (operation.kind === "create") {
      const created = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: operation.path, content: "" }),
      });
      if (!created.ok) throw new Error(`create failed (${created.status})`);
      await markServerCreated(operation.id);

      let staged = await peekPendingContent(operation.contentKey ?? operation.path);
      if (staged === null && operation.content !== undefined && !isDirty(operation.path)) {
        staged = operation.content;
      }
      if (staged !== null) {
        const written = await fetch(`/api/documents/${encodePath(operation.path)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: staged }),
        });
        if (!written.ok) {
          throw new Error(`initial content failed (${written.status})`);
        }
        await clearPendingContent(operation.contentKey ?? operation.path);
      }
    } else if (operation.kind === "delete") {
      const response = await fetch(`/api/notes/${encodePath(operation.path)}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) throw new Error();
    } else if (operation.kind === "mkdir") {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: operation.path }),
      });
      if (!response.ok) throw new Error();
    } else {
      const response = await fetch(`/api/notes/${encodePath(operation.from)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_path: operation.to }),
      });
      if (!response.ok) throw new Error();
    }
    await removeQueued(operation.id);
    return true;
  } catch {
    return false;
  }
}

async function runLimited(operations: Pending[], limit: number): Promise<number> {
  let cursor = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(limit, operations.length) }, async () => {
    while (cursor < operations.length) {
      const operation = operations[cursor++];
      if (await processOperation(operation)) completed += 1;
    }
  });
  await Promise.all(workers);
  return completed;
}

let activeFlush: Promise<FlushResult> | null = null;

/** Replay queued metadata operations without allowing overlapping flushes. */
export function flushQueue(): Promise<FlushResult> {
  if (activeFlush) return activeFlush;
  activeFlush = (async () => {
    let server: VaultListing;
    try {
      const response = await fetch("/api/notes");
      if (!response.ok) throw new Error();
      server = await response.json();
    } catch {
      const queue = (await getKV<Pending[]>("queue")) ?? [];
      return { completed: 0, remaining: queue.length, pathChanges: [] };
    }

    const pathChanges = await reconcileImportConflicts(server);
    const queue = await ensureQueueIds();
    let completed = 0;
    let index = 0;
    while (index < queue.length) {
      const operation = queue[index];
      if (operation.kind === "mkdir" || operation.kind === "create") {
        const kind = operation.kind;
        const block: Pending[] = [];
        while (index < queue.length && queue[index].kind === kind) {
          block.push(queue[index]);
          index += 1;
        }
        completed += await runLimited(block, REPLAY_CONCURRENCY);
      } else {
        if (await processOperation(operation)) completed += 1;
        index += 1;
      }
    }
    const remaining = ((await getKV<Pending[]>("queue")) ?? []).length;
    return { completed, remaining, pathChanges };
  })().finally(() => {
    activeFlush = null;
  });
  return activeFlush;
}

export async function pendingCreatePaths(paths: readonly string[]): Promise<Set<string>> {
  const wanted = new Set(paths);
  const queue = (await getKV<Pending[]>("queue")) ?? [];
  return new Set(
    queue
      .filter(
        (operation): operation is CreatePending =>
          operation.kind === "create" && wanted.has(operation.path),
      )
      .map((operation) => operation.path),
  );
}
