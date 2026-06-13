import { emit } from "./events";
import { encodePath } from "../store/notes";
import { useUI } from "../store/ui";
import { preserveEditorFocusForNavigation } from "./editor";

/* Bridges router-owned navigation into framework-agnostic core code.
   AppShell wires the real navigate function and route state in. */

let navigateFn: (to: string) => void = () => {
  console.warn("[navigation] navigate called before router was wired");
};
let currentNoteId: string | null = null;

export function setNavigator(fn: (to: string) => void): void {
  navigateFn = fn;
}

export function openNote(path: string): void {
  preserveEditorFocusForNavigation();
  useUI.getState().recordRecentNote(path);
  navigateFn(`/note/${encodePath(path)}`);
}

export function openTag(tag: string): void {
  navigateFn(`/tag/${encodePath(tag)}`);
}

/** Called by the shell whenever the route's note id changes. */
export function setActiveNoteId(id: string | null): void {
  if (id === currentNoteId) return;
  currentNoteId = id;
  if (id !== null) emit("note:open", id);
}

export function activeNoteId(): string | null {
  return currentNoteId;
}
