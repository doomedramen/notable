// Note *metadata* (the sidebar list) also needs to work offline.
// Strategy: cache the vault listing in IndexedDB; queue mutations made
// offline and replay them when the server is reachable again.
//
// Identity = vault-relative path ("Projects/Plan.md"); name = filename
// stem. Offline clients pick the path at creation time (deduped against
// the cached listing) so creation is idempotent on replay — and if two
// devices create the same path offline, their edits simply merge via
// CRDT into one note.

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

type Pending =
  | { kind: "create"; path: string }
  | { kind: "delete"; path: string }
  | { kind: "rename"; from: string; to: string }
  | { kind: "mkdir"; path: string };

const DB_NAME = "notable-meta";
const STORE = "kv";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(STORE, "readwrite")
      .objectStore(STORE)
      .put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Encode a vault path for use in a URL (keeps "/" separators). */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

const EMPTY: VaultListing = { notes: [], folders: [] };

export async function listVault(): Promise<VaultListing> {
  try {
    const res = await fetch("/api/notes");
    if (!res.ok) throw new Error();
    const listing: VaultListing = await res.json();
    await kvSet("vault", listing);
    return listing;
  } catch {
    return (await kvGet<VaultListing>("vault")) ?? EMPTY;
  }
}

function buildMeta(path: string): NoteMeta {
  const slash = path.lastIndexOf("/");
  const file = slash === -1 ? path : path.slice(slash + 1);
  return {
    path,
    name: file.replace(/\.md$/, ""),
    folder: slash === -1 ? "" : path.slice(0, slash),
    modified: Date.now(),
  };
}

/** Pick a free path for a new note against the cached listing. */
async function freePath(name: string, folder: string): Promise<string> {
  const cached = (await kvGet<VaultListing>("vault")) ?? EMPTY;
  const taken = new Set(cached.notes.map((n) => n.path));
  const prefix = folder ? `${folder}/` : "";
  let candidate = `${prefix}${name}.md`;
  let n = 1;
  while (taken.has(candidate)) {
    candidate = `${prefix}${name} ${n}.md`;
    n += 1;
  }
  return candidate;
}

export async function createNote(
  name = "Untitled",
  folder = "",
): Promise<NoteMeta> {
  const path = await freePath(name, folder);
  const meta = buildMeta(path);

  // Optimistic local insert
  const cached = (await kvGet<VaultListing>("vault")) ?? EMPTY;
  await kvSet("vault", { ...cached, notes: [meta, ...cached.notes] });

  try {
    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  } catch {
    await enqueue({ kind: "create", path });
  }
  return meta;
}

export async function deleteNote(path: string): Promise<void> {
  const cached = (await kvGet<VaultListing>("vault")) ?? EMPTY;
  await kvSet("vault", {
    ...cached,
    notes: cached.notes.filter((n) => n.path !== path),
  });
  try {
    const res = await fetch(`/api/notes/${encodePath(path)}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status >= 500) throw new Error();
  } catch {
    await enqueue({ kind: "delete", path });
  }
}

/** Rename/move. NOTE: unsynced offline edits under the old path stay
    keyed to it; rename while offline with unsynced content is the one
    flow that can strand edits (rare; documented). */
export async function renameNote(from: string, to: string): Promise<NoteMeta> {
  const meta = buildMeta(to);
  const cached = (await kvGet<VaultListing>("vault")) ?? EMPTY;
  await kvSet("vault", {
    ...cached,
    notes: cached.notes.map((n) => (n.path === from ? meta : n)),
  });
  try {
    const res = await fetch(`/api/notes/${encodePath(from)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_path: to }),
    });
    if (!res.ok) throw new Error();
  } catch {
    await enqueue({ kind: "rename", from, to });
  }
  return meta;
}

export async function createFolder(path: string): Promise<void> {
  const cached = (await kvGet<VaultListing>("vault")) ?? EMPTY;
  if (!cached.folders.includes(path)) {
    await kvSet("vault", {
      ...cached,
      folders: [...cached.folders, path].sort(),
    });
  }
  try {
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error();
  } catch {
    await enqueue({ kind: "mkdir", path });
  }
}

/** Delete an empty folder. Throws if the server refuses (not empty). */
export async function deleteFolder(path: string): Promise<void> {
  const res = await fetch(`/api/folders/${encodePath(path)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(res.status === 409 ? "not-empty" : "failed");
  const cached = (await kvGet<VaultListing>("vault")) ?? EMPTY;
  await kvSet("vault", {
    ...cached,
    folders: cached.folders.filter(
      (f) => f !== path && !f.startsWith(`${path}/`),
    ),
  });
}

async function enqueue(op: Pending) {
  const q = (await kvGet<Pending[]>("queue")) ?? [];
  await kvSet("queue", [...q, op]);
}

/** Replay queued metadata ops. Call on app start, `online` events and
    when the sync layer reports the server reachable. */
export async function flushQueue(): Promise<void> {
  const q = (await kvGet<Pending[]>("queue")) ?? [];
  if (q.length === 0) return;
  const remaining: Pending[] = [];
  for (const op of q) {
    try {
      if (op.kind === "create") {
        await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: op.path }),
        });
      } else if (op.kind === "delete") {
        await fetch(`/api/notes/${encodePath(op.path)}`, { method: "DELETE" });
      } else if (op.kind === "mkdir") {
        await fetch("/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: op.path }),
        });
      } else {
        await fetch(`/api/notes/${encodePath(op.from)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_path: op.to }),
        });
      }
    } catch {
      remaining.push(op);
    }
  }
  await kvSet("queue", remaining);
}
