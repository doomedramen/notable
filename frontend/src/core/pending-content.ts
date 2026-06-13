const PREFIX = "notable-pending-content:";

/** One-shot handoff for content a freshly-created note should start with
    (e.g. from the share target), consumed by the editor on first mount. */
export function setPendingContent(path: string, content: string): void {
  sessionStorage.setItem(PREFIX + path, content);
}

export function takePendingContent(path: string): string | null {
  const key = PREFIX + path;
  const content = sessionStorage.getItem(key);
  if (content !== null) sessionStorage.removeItem(key);
  return content;
}
