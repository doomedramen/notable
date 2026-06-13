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
    const statusItem = api.workspace.registerStatusBarItem({
      id: "word-count",
      text: "0 words",
      tooltip: "No note is open",
    });

    const render = (editor: EditorView | null) => {
      if (!editor) {
        statusItem.update({
          text: "0 words",
          tooltip: "No note is open",
        });
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
        statusItem.update({
          text: `${selected} selected · ${words} total`,
          tooltip: `${characters} character${characters === 1 ? "" : "s"}`,
        });
      } else {
        statusItem.update({
          text: `${words} word${words === 1 ? "" : "s"}`,
          tooltip: `${characters} character${characters === 1 ? "" : "s"}`,
        });
      }
    };

    const renderActive = () => {
      render(api.editor.activeView());
    };

    renderActive();

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
