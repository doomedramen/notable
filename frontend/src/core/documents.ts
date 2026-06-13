import type {
  DocumentSnapshot,
  DocumentTextEdit,
  DocumentWriteOptions,
} from "@/plugin-api";
import { Annotation } from "@codemirror/state";
import { activeView } from "./editor";
import { emit } from "./events";
import { activeNoteId } from "./navigation";
import {
  pluginAPIError,
  requestError,
  responseError,
} from "./plugin-api-error";
import { encodePath } from "@/store/notes";
import { useNotesStore } from "@/store/notes-store";

/** Marks active-editor transactions initiated through `api.documents`. */
export const pluginDocumentChange = Annotation.define<boolean>();

/** SHA-256 is shared with the server and treated as an opaque revision. */
async function revision(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  // Web Crypto may be unavailable on non-secure LAN origins. This fallback is
  // intentionally prefixed so it can only compare active local snapshots; if
  // the note closes before a write, the server safely reports a conflict.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `local-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function activeDocument(path: string) {
  if (activeNoteId() !== path) return null;
  return activeView();
}

async function activeSnapshot(path: string): Promise<DocumentSnapshot | null> {
  const view = activeDocument(path);
  if (!view) return null;
  const text = view.state.doc.toString();
  return { path, text, revision: await revision(text) };
}

function assertExpected(
  snapshot: DocumentSnapshot,
  options?: DocumentWriteOptions,
): void {
  if (
    options?.expectedRevision !== undefined &&
    options.expectedRevision !== snapshot.revision
  ) {
    throw pluginAPIError(
      "CONFLICT",
      `Document "${snapshot.path}" changed after it was read.`,
      409,
    );
  }
}

function conflict(path: string): never {
  throw pluginAPIError(
    "CONFLICT",
    `Document "${path}" changed after it was read.`,
    409,
  );
}

function validateEdits(text: string, edits: readonly DocumentTextEdit[]): void {
  let previousTo = 0;
  for (const [index, edit] of edits.entries()) {
    if (
      !Number.isInteger(edit.from) ||
      !Number.isInteger(edit.to) ||
      edit.from < 0 ||
      edit.to < edit.from ||
      edit.to > text.length ||
      typeof edit.insert !== "string" ||
      (index > 0 && edit.from < previousTo)
    ) {
      throw pluginAPIError(
        "INVALID_ARGUMENT",
        "Document edits must be sorted, non-overlapping UTF-16 ranges.",
      );
    }
    previousTo = edit.to;
  }
}

export async function read(path: string): Promise<DocumentSnapshot> {
  const local = await activeSnapshot(path);
  if (local) return local;

  try {
    const response = await fetch(`/api/documents/${encodePath(path)}`);
    if (!response.ok) {
      throw await responseError(response, `Could not read "${path}".`);
    }
    return (await response.json()) as DocumentSnapshot;
  } catch (error) {
    throw requestError(error, `Could not read "${path}".`);
  }
}

export async function replace(
  path: string,
  text: string,
  options?: DocumentWriteOptions,
): Promise<DocumentSnapshot> {
  const view = activeDocument(path);
  if (view) {
    const before = await activeSnapshot(path);
    if (!before) {
      throw pluginAPIError("NOT_FOUND", `Document "${path}" is not open.`);
    }
    assertExpected(before, options);
    // SHA-256 is asynchronous. Recheck the exact buffer immediately before
    // dispatch so a keystroke during hashing cannot satisfy a stale revision.
    const currentText = view.state.doc.toString();
    if (
      options?.expectedRevision !== undefined &&
      currentText !== before.text
    ) {
      conflict(path);
    }
    if (currentText !== text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: pluginDocumentChange.of(true),
      });
    }
    return {
      path,
      text: view.state.doc.toString(),
      revision: await revision(view.state.doc.toString()),
    };
  }

  try {
    const response = await fetch(`/api/documents/${encodePath(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        expectedRevision: options?.expectedRevision,
      }),
    });
    if (!response.ok) {
      throw await responseError(response, `Could not write "${path}".`);
    }
    const snapshot = (await response.json()) as DocumentSnapshot;
    useNotesStore.getState().touch(path);
    emit("note:change", { path, source: "plugin" });
    return snapshot;
  } catch (error) {
    throw requestError(error, `Could not write "${path}".`);
  }
}

export async function applyEdits(
  path: string,
  edits: DocumentTextEdit[],
  options?: DocumentWriteOptions,
): Promise<DocumentSnapshot> {
  const before = await read(path);
  assertExpected(before, options);
  validateEdits(before.text, edits);
  if (edits.length === 0) return before;

  const view = activeDocument(path);
  if (view) {
    if (view.state.doc.toString() !== before.text) conflict(path);
    // CodeMirror applies a sorted change set against the same pre-change
    // document, preserving small CRDT operations instead of replacing all
    // text for common formatter and refactoring plugins.
    view.dispatch({
      changes: edits,
      annotations: pluginDocumentChange.of(true),
    });
    const text = view.state.doc.toString();
    return { path, text, revision: await revision(text) };
  }

  let text = before.text;
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index];
    text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  }
  return replace(path, text, { expectedRevision: before.revision });
}
