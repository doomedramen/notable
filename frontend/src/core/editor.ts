import { createStore } from "zustand";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Disposable } from "@/plugin-api";

/* Plugin-contributed CodeMirror extensions. Editor.tsx wraps the array
   in a Compartment and reconfigures live when this store changes, so
   enabling/disabling a plugin applies without remounting the editor. */

interface EditorExtensionState {
  extensions: readonly Extension[];
}

export const editorExtensionStore = createStore<EditorExtensionState>(() => ({
  extensions: [],
}));

export function registerEditorExtension(ext: Extension): Disposable {
  editorExtensionStore.setState((s) => ({
    extensions: [...s.extensions, ext],
  }));
  return {
    dispose: () => {
      editorExtensionStore.setState((s) => ({
        extensions: s.extensions.filter((e) => e !== ext),
      }));
    },
  };
}

let active: EditorView | null = null;
let restoreFocusUntil = 0;

export function setActiveView(view: EditorView | null): void {
  active = view;
}

export function activeView(): EditorView | null {
  return active;
}

/** Capture editor focus before pointer navigation moves it to app chrome. */
export function preserveEditorFocusForNavigation(): void {
  if (active?.hasFocus) restoreFocusUntil = Date.now() + 750;
}

/** Consume a recent focus handoff when the next note editor mounts. */
export function consumeEditorFocusRestore(): boolean {
  const restore = Date.now() <= restoreFocusUntil;
  restoreFocusUntil = 0;
  return restore;
}
