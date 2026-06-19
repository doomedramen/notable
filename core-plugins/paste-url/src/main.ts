import type { NotablePlugin } from "notable-plugin-api";

function isWebUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}

function escapeDestination(value: string): string {
  return value.replaceAll("(", "\\(").replaceAll(")", "\\)");
}

const plugin: NotablePlugin = {
  onload(api) {
    const { EditorView } = api.modules.codemirror.view;

    api.editor.registerExtension(
      EditorView.domEventHandlers({
        paste(event, view) {
          const clipboard = event.clipboardData?.getData("text/plain").trim();
          if (!clipboard || !isWebUrl(clipboard)) return false;

          event.preventDefault();

          const selection = view.state.selection.main;
          if (selection.empty) {
            const markdown = `[](${escapeDestination(clipboard)})`;
            view.dispatch({
              changes: {
                from: selection.from,
                insert: markdown,
              },
              selection: { anchor: selection.from + 1 },
              scrollIntoView: true,
            });
            return true;
          }

          const label = view.state.doc.sliceString(selection.from, selection.to);
          if (!label.trim() || label.includes("\n")) return false;

          const markdown = `[${escapeLabel(label)}](${escapeDestination(clipboard)})`;
          view.dispatch({
            changes: {
              from: selection.from,
              to: selection.to,
              insert: markdown,
            },
            selection: { anchor: selection.from + markdown.length },
            scrollIntoView: true,
          });
          return true;
        },
      }),
    );
  },
};

export default plugin;
