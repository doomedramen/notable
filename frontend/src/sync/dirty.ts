// Tracks which notes have local edits the server hasn't received yet.
// Persisted to localStorage so the warning survives reloads while offline.
// This exists because iOS Safari may evict IndexedDB after ~7 days of
// non-use (for non-installed PWAs) or under disk pressure — users must
// be able to SEE when their only copy of an edit is the local one.

const KEY = "notable-dirty-notes";
const CONTENT_PREFIX = "notable-dirty-content:";
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

function contentKey(noteId: string): string {
  return `${CONTENT_PREFIX}${noteId}`;
}

export function markDirty(noteId: string, content?: string) {
  // IndexedDB writes are asynchronous and can be aborted by an immediate
  // reload. Keep a synchronous recovery copy while the note is unsynced.
  if (content !== undefined) {
    localStorage.setItem(contentKey(noteId), content);
  }

  const ids = read();
  if (!ids.has(noteId)) {
    ids.add(noteId);
    write(ids);
  }
}

export function markClean(noteId: string) {
  localStorage.removeItem(contentKey(noteId));
  const ids = read();
  if (ids.delete(noteId)) {
    write(ids);
  }
}

export function dirtyCount(): number {
  return read().size;
}

export function dirtyNotes(): string[] {
  return [...read()];
}

export function isDirty(noteId: string): boolean {
  return read().has(noteId);
}

export function dirtyContent(noteId: string): string | null {
  return localStorage.getItem(contentKey(noteId));
}

export function moveDirty(from: string, to: string): void {
  const ids = read();
  const content = dirtyContent(from);
  localStorage.removeItem(contentKey(from));
  if (content !== null) {
    localStorage.setItem(contentKey(to), content);
  }
  if (ids.delete(from)) ids.add(to);
  write(ids);
}
