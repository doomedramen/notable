const PREFIX = "notable-pending-content:";

/** One-shot handoff for content a freshly-created note should start with
    (e.g. from the share target), consumed by the editor on first mount.
    localStorage keeps offline-created content across an app restart. */
export function setPendingContent(path: string, content: string): void {
  localStorage.setItem(PREFIX + path, content);
}

/** Inspect a handoff without consuming it (used by offline queue replay). */
export function peekPendingContent(path: string): string | null {
  return localStorage.getItem(PREFIX + path);
}

export function clearPendingContent(path: string): void {
  localStorage.removeItem(PREFIX + path);
}

export function takePendingContent(path: string): string | null {
  const key = PREFIX + path;
  const content = localStorage.getItem(key);
  if (content !== null) localStorage.removeItem(key);
  return content;
}
