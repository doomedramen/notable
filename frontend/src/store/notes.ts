// Note *metadata* (the sidebar list) also needs to work offline.
// Strategy: cache the list in IndexedDB; queue mutations made offline
// and replay them when connectivity returns. Note IDs are generated
// client-side (UUID v4) so offline-created notes keep their identity.

export interface NoteMeta {
  id: string;
  title: string;
  updated_at: string;
}

type Pending =
  | { kind: "create"; id: string; title: string }
  | { kind: "delete"; id: string };

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
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function listNotes(): Promise<NoteMeta[]> {
  try {
    const res = await fetch("/api/notes");
    if (!res.ok) throw new Error();
    const notes: NoteMeta[] = await res.json();
    await kvSet("notes", notes);
    return notes;
  } catch {
    return (await kvGet<NoteMeta[]>("notes")) ?? [];
  }
}

export async function createNote(title: string): Promise<NoteMeta> {
  const id = crypto.randomUUID();
  const meta: NoteMeta = { id, title, updated_at: new Date().toISOString() };

  // Optimistic local insert
  const cached = (await kvGet<NoteMeta[]>("notes")) ?? [];
  await kvSet("notes", [meta, ...cached]);

  try {
    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title }),
    });
  } catch {
    await enqueue({ kind: "create", id, title });
  }
  return meta;
}

export async function deleteNote(id: string): Promise<void> {
  const cached = (await kvGet<NoteMeta[]>("notes")) ?? [];
  await kvSet("notes", cached.filter((n) => n.id !== id));
  try {
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
  } catch {
    await enqueue({ kind: "delete", id });
  }
}

async function enqueue(op: Pending) {
  const q = (await kvGet<Pending[]>("queue")) ?? [];
  await kvSet("queue", [...q, op]);
}

/** Replay queued metadata ops. Call on app start and on `online` events. */
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
          body: JSON.stringify({ id: op.id, title: op.title }),
        });
      } else {
        await fetch(`/api/notes/${op.id}`, { method: "DELETE" });
      }
    } catch {
      remaining.push(op);
    }
  }
  await kvSet("queue", remaining);
}
