import {
  deleteStagedContent,
  getStagedContent,
  putStagedContent,
} from "@/store/vault-db";

const LEGACY_PREFIX = "notable-pending-content:";

/** Stage initial text without relying on localStorage's small quota. */
export async function setPendingContent(
  path: string,
  content: string,
): Promise<void> {
  await putStagedContent(path, content);
}

/** Inspect a handoff without consuming it (used by offline queue replay). */
export async function peekPendingContent(path: string): Promise<string | null> {
  const staged = await getStagedContent(path);
  if (staged !== undefined) return staged;
  return localStorage.getItem(LEGACY_PREFIX + path);
}

export async function clearPendingContent(path: string): Promise<void> {
  await deleteStagedContent(path);
  localStorage.removeItem(LEGACY_PREFIX + path);
}

export async function takePendingContent(path: string): Promise<string | null> {
  const content = await peekPendingContent(path);
  if (content !== null) await clearPendingContent(path);
  return content;
}
