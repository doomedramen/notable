// Example Notable plugin: live word count in the status bar.
//
// Demonstrates the core API surface:
//   - workspace.registerStatusBarItem (mount-based UI)
//   - editor.registerExtension using the HOST's CodeMirror via api.modules
//     (never bundle your own copy of @codemirror/* — see docs/plugins.md)
//   - events.on("editor:ready") for note switches
//
// This file is plain JS on purpose: a plugin can be a single hand-written
// ES module. For TypeScript, compile against src/plugin-api/index.ts with
// @codemirror/* and yjs marked external.

function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export default {
  onload(api) {
    const { view } = api.modules.codemirror;
    let label = null;

    const render = (text) => {
      if (!label) return;
      const words = countWords(text);
      label.textContent = `${words} word${words === 1 ? "" : "s"}`;
    };

    const renderActive = () => {
      const active = api.editor.activeView();
      render(active ? active.state.doc.toString() : "");
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
        if (update.docChanged) render(update.state.doc.toString());
      }),
    );

    // …and when a different note's editor comes up.
    api.events.on("editor:ready", () => renderActive());
  },
};
