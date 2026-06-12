// Tracks which notes have local edits the server hasn't received yet.
// Persisted to localStorage so the warning survives reloads while offline.
// This exists because iOS Safari may evict IndexedDB after ~7 days of
// non-use (for non-installed PWAs) or under disk pressure — users must
// be able to SEE when their only copy of an edit is the local one.

const KEY = "notable-dirty-notes";
export const DIRTY_EVENT = "notable-dirty-changed";

function read(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function write(ids: Set<string>) {
  localStorage.setItem(KEY, JSON.stringify([...ids]));
  window.dispatchEvent(new CustomEvent(DIRTY_EVENT, { detail: ids.size }));
}

export function markDirty(noteId: string) {
  const ids = read();
  if (!ids.has(noteId)) {
    ids.add(noteId);
    write(ids);
  }
}

export function markClean(noteId: string) {
  const ids = read();
  if (ids.delete(noteId)) {
    write(ids);
  }
}

export function dirtyCount(): number {
  return read().size;
}

export function isDirty(noteId: string): boolean {
  return read().has(noteId);
}
