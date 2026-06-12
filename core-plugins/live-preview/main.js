// Core Notable plugin: live preview.
//
// Obsidian-style "what you see is what you mean": markdown syntax marks
// (#, **, _, ~~, `, list/task markers...) are hidden on lines the cursor
// isn't touching, while the styled content remains. Touch a line (click
// or move the cursor onto it) and its raw syntax reappears for editing.
//
// Built from the syntax tree (markdown() + GFM, see editor/Editor.tsx)
// over `view.visibleRanges` only — never the whole document.

const HEADING_RE = /^ATXHeading([1-6])$/;

const STYLE_ID = "notable-live-preview-style";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .cm-hl-heading { font-weight: 700; line-height: 1.3; }
    .cm-hl-heading-1 { font-size: 1.6em; }
    .cm-hl-heading-2 { font-size: 1.4em; }
    .cm-hl-heading-3 { font-size: 1.25em; }
    .cm-hl-heading-4 { font-size: 1.1em; }
    .cm-hl-heading-5 { font-size: 1em; }
    .cm-hl-heading-6 { font-size: 0.95em; color: var(--faint); }
    .cm-hl-strong { font-weight: 700; }
    .cm-hl-em { font-style: italic; }
    .cm-hl-strike { text-decoration: line-through; opacity: 0.7; }
    .cm-hl-code {
      font-family: var(--font-mono, monospace);
      background: var(--surface-hover);
      border-radius: 0.25rem;
      padding: 0.05em 0.3em;
      font-size: 0.9em;
    }
    .cm-task-checkbox {
      margin: 0 0.4em 0 0;
      vertical-align: middle;
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

export default {
  onload(api) {
    injectStyles();

    const { state: cmState, view: cmView, language } = api.modules.codemirror;
    const { Decoration, ViewPlugin, EditorView, WidgetType } = cmView;
    const { RangeSetBuilder } = cmState;
    const { syntaxTree } = language;

    class CheckboxWidget extends WidgetType {
      constructor(checked, from, to) {
        super();
        this.checked = checked;
        this.from = from;
        this.to = to;
      }
      eq(other) {
        return (
          other.checked === this.checked &&
          other.from === this.from &&
          other.to === this.to
        );
      }
      toDOM(view) {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.className = "cm-task-checkbox";
        box.checked = this.checked;
        box.onmousedown = (event) => {
          event.preventDefault();
          view.dispatch({
            changes: {
              from: this.from,
              to: this.to,
              insert: this.checked ? "[ ]" : "[x]",
            },
          });
        };
        return box;
      }
      ignoreEvent() {
        return false;
      }
    }

    function build(view) {
      const builder = new RangeSetBuilder();
      const { state } = view;
      const sel = state.selection;

      const lineIsActive = (from, to) => {
        for (const range of sel.ranges) {
          if (range.from <= to && range.to >= from) return true;
        }
        return false;
      };

      for (const { from, to } of view.visibleRanges) {
        syntaxTree(state).iterate({
          from,
          to,
          enter(node) {
            const headingMatch = HEADING_RE.exec(node.name);
            if (headingMatch) {
              const line = state.doc.lineAt(node.from);
              builder.add(
                line.from,
                line.from,
                Decoration.line({
                  class: `cm-hl-heading cm-hl-heading-${headingMatch[1]}`,
                }),
              );
              if (!lineIsActive(line.from, line.to)) {
                const mark = node.node.getChild("HeaderMark");
                if (mark) {
                  let end = mark.to;
                  if (state.doc.sliceString(end, end + 1) === " ") end++;
                  builder.add(node.from, end, Decoration.replace({}));
                }
              }
              return;
            }

            switch (node.name) {
              case "Emphasis":
              case "StrongEmphasis":
              case "Strikethrough":
              case "InlineCode": {
                const line = state.doc.lineAt(node.from);
                if (lineIsActive(line.from, line.to)) return;
                const markName =
                  node.name === "InlineCode" ? "CodeMark" : "EmphasisMark";
                const contentClass =
                  node.name === "StrongEmphasis"
                    ? "cm-hl-strong"
                    : node.name === "Strikethrough"
                      ? "cm-hl-strike"
                      : node.name === "InlineCode"
                        ? "cm-hl-code"
                        : "cm-hl-em";
                const marks =
                  node.name === "Strikethrough"
                    ? node.node.getChildren("StrikethroughMark")
                    : node.node.getChildren(markName);
                const open = marks[0];
                const close = marks[marks.length - 1];
                if (!open || !close || open === close) return;
                builder.add(open.from, open.to, Decoration.replace({}));
                builder.add(
                  open.to,
                  close.from,
                  Decoration.mark({ class: contentClass }),
                );
                builder.add(close.from, close.to, Decoration.replace({}));
                return;
              }
              case "TaskMarker": {
                const line = state.doc.lineAt(node.from);
                if (lineIsActive(line.from, line.to)) return;
                const text = state.doc.sliceString(node.from, node.to);
                const checked = text === "[x]" || text === "[X]";
                builder.add(
                  node.from,
                  node.to,
                  Decoration.replace({
                    widget: new CheckboxWidget(checked, node.from, node.to),
                  }),
                );
                return;
              }
              default:
                return;
            }
          },
        });
      }

      return builder.finish();
    }

    const livePreviewPlugin = ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = build(view);
        }
        update(update) {
          if (update.view.composing) return;
          if (
            update.docChanged ||
            update.selectionSet ||
            update.viewportChanged
          ) {
            this.decorations = build(update.view);
          }
        }
      },
      {
        decorations: (v) => v.decorations,
        provide: (plugin) =>
          EditorView.atomicRanges.of((view) => {
            return view.plugin(plugin)?.decorations ?? Decoration.none;
          }),
      },
    );

    api.editor.registerExtension([livePreviewPlugin]);
  },
};
