// Core Notable plugin: Obsidian-style [[wikilinks]].
//
//  - Renders [[Target]] / [[Target|Alias]] as a pill, hiding the
//    brackets (and target/pipe when aliased) — but only on lines the
//    cursor isn't touching, so editing the raw syntax stays easy.
//  - Mod-click (Cmd on macOS, Ctrl elsewhere) a pill to open the note,
//    creating it first if it doesn't exist yet (Obsidian's "unresolved
//    link" behavior).
//  - Autocompletes note titles after typing "[[".
//
// Decorations are computed with a plain regex over visible text rather
// than the syntax tree: wikilinks aren't part of CommonMark/GFM, so CM6's
// markdown grammar has no node for them (same regex shape as the
// server-side indexer, for parity).

const WIKILINK = /\[\[([^[\]#|\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/gd;

const STYLE_ID = "notable-wikilinks-style";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .cm-wikilink {
      color: var(--accent);
      background: var(--accent-soft);
      border-radius: 0.25rem;
      padding: 0 0.2em;
      cursor: pointer;
    }
    .cm-wikilink-unresolved {
      color: var(--faint);
      background: transparent;
      border-bottom: 1px dashed var(--border);
    }
  `;
  document.head.appendChild(style);
}

export default {
  onload(api) {
    injectStyles();
    const { state: cmState, view: cmView, autocomplete: cmAutocomplete } =
      api.modules.codemirror;
    const { Decoration, ViewPlugin, EditorView } = cmView;
    const { RangeSetBuilder } = cmState;

    let notes = [];
    const refreshNotes = () => {
      api.vault.list().then((list) => {
        notes = list;
      });
    };
    refreshNotes();
    api.events.on("note:create", refreshNotes);
    api.events.on("note:open", refreshNotes);

    function resolve(target) {
      const norm = target.trim().toLowerCase();
      return notes.find(
        (n) => n.name.toLowerCase() === norm || n.path.toLowerCase() === norm,
      );
    }

    async function followLink(target) {
      const existing = resolve(target);
      if (existing) {
        api.workspace.openNote(existing.path);
        return;
      }
      const meta = await api.vault.create(target.trim());
      notes = [meta, ...notes];
      api.workspace.openNote(meta.path);
    }

    function build(view) {
      const builder = new RangeSetBuilder();
      const sel = view.state.selection.main;
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        for (const m of text.matchAll(WIKILINK)) {
          const start = from + m.index;
          const end = start + m[0].length;
          // The link the cursor is touching is shown raw, for editing.
          if (sel.from <= end && sel.to >= start) continue;

          const target = m[1].trim();
          const [g1Start, g1End] = m.indices[1];
          const g2 = m.indices[2];
          const labelFrom = from + (g2 ? g2[0] : g1Start);
          const labelTo = from + (g2 ? g2[1] : g1End);
          const resolved = resolve(target);

          builder.add(start, labelFrom, Decoration.replace({}));
          builder.add(
            labelFrom,
            labelTo,
            Decoration.mark({
              class: resolved ? "cm-wikilink" : "cm-wikilink cm-wikilink-unresolved",
              attributes: {
                "data-wikilink-target": target,
                title: resolved
                  ? `${resolved.path} — Mod-click to open`
                  : `Create "${target}" — Mod-click to open`,
              },
            }),
          );
          builder.add(labelTo, end, Decoration.replace({}));
        }
      }
      return builder.finish();
    }

    const wikilinkPlugin = ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = build(view);
        }
        update(update) {
          if (
            update.docChanged ||
            update.selectionSet ||
            update.viewportChanged
          ) {
            this.decorations = build(update.view);
          }
        }
      },
      { decorations: (v) => v.decorations },
    );

    const clickHandler = EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const el = event.target.closest?.(".cm-wikilink");
        if (!el || !view.dom.contains(el)) return false;
        event.preventDefault();
        void followLink(el.dataset.wikilinkTarget);
        return true;
      },
    });

    api.editor.registerExtension([wikilinkPlugin, clickHandler]);

    // "[[" autocomplete over vault note titles.
    api.editor.registerExtension(
      cmAutocomplete.autocompletion({
        override: [
          (context) => {
            const match = context.matchBefore(/\[\[[^\]\n]*/);
            if (!match) return null;
            const query = match.text.slice(2).toLowerCase();
            const options = notes
              .filter((n) => n.name.toLowerCase().includes(query))
              .slice(0, 10)
              .map((n) => ({
                label: n.name,
                type: "file",
                detail: n.folder || undefined,
                apply: (view, completion, from, to) => {
                  view.dispatch({
                    changes: { from, to, insert: `${completion.label}]]` },
                    selection: { anchor: from + completion.label.length + 2 },
                  });
                },
              }));
            return { from: match.from + 2, options, validFor: /^[^\]\n]*$/ };
          },
        ],
      }),
    );
  },
};
