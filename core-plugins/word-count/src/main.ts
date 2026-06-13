// Core Notable plugin: live word count in the status bar.
//
// Demonstrates the core API surface:
//   - workspace.registerStatusBarItem (mount-based UI)
//   - editor.registerExtension using the HOST's CodeMirror via api.modules
//     (never bundle your own copy of @codemirror/* — see docs/plugins.md)
//   - events.on("editor:ready") for note switches
import type { EditorView } from "@codemirror/view";
import type { NotablePlugin } from "notable-plugin-api";

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

const plugin: NotablePlugin = {
  onload(api) {
    const { view } = api.modules.codemirror;
    let label: HTMLSpanElement | null = null;

    const render = (editor: EditorView | null) => {
      if (!label) return;
      if (!editor) {
        label.textContent = "0 words";
        label.title = "No note is open";
        return;
      }

      const text = editor.state.doc.toString();
      const selection = editor.state.selection.main;
      const words = countWords(text);
      const characters = text.length;
      if (!selection.empty) {
        const selected = countWords(
          editor.state.doc.sliceString(selection.from, selection.to),
        );
        label.textContent = `${selected} selected · ${words} total`;
      } else {
        label.textContent = `${words} word${words === 1 ? "" : "s"}`;
      }
      label.title = `${characters} character${characters === 1 ? "" : "s"}`;
    };

    const renderActive = () => {
      render(api.editor.activeView());
    };

    api.workspace.registerStatusBarItem({
      id: "word-count",
      mount(el) {
        label = document.createElement("span");
        label.style.fontVariantNumeric = "tabular-nums";
        el.appendChild(label);
        renderActive();
        return () => {
          label = null;
          el.textContent = "";
        };
      },
    });

    // Recount as the user types…
    api.editor.registerExtension(
      view.EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) render(update.view);
      }),
    );

    // …and when a different note's editor comes up.
    api.events.on("editor:ready", () => renderActive());
  },
};

export default plugin;
