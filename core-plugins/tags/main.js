// Core Notable plugin: tags.
//
//  - Sidebar panel listing every #tag in the vault (GET /api/tags), with
//    counts; clicking a tag opens its note list (/tag/<tag>).
//  - Inline #tag chips in the editor; Mod-click opens the same view.
//
// Tag regex mirrors the server-side extractor in indexer.rs.
const TAG = /(?:^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)/gd;

const STYLE_ID = "notable-tags-style";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .notable-tags-empty {
      padding: 0.5rem 0.75rem;
      font-size: 12px;
      color: var(--faint);
    }
    .notable-tags-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0.5rem;
    }
    .notable-tags-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      background: var(--surface-hover);
      border: none;
      color: var(--foreground);
      font-size: 12px;
      cursor: pointer;
    }
    .notable-tags-chip:hover {
      background: var(--accent-soft);
      color: var(--accent);
    }
    .notable-tags-chip-count {
      color: var(--faint);
      font-variant-numeric: tabular-nums;
    }
    .cm-tag {
      color: var(--accent);
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

export default {
  onload(api) {
    injectStyles();

    const { state: cmState, view: cmView } = api.modules.codemirror;
    const { Decoration, ViewPlugin, EditorView } = cmView;
    const { RangeSetBuilder } = cmState;

    // --- Sidebar panel -----------------------------------------------
    let container = null;
    let abort = null;

    async function renderPanel() {
      if (!container) return;
      abort?.abort();
      abort = new AbortController();
      let tags;
      try {
        const res = await fetch("/api/tags", { signal: abort.signal });
        tags = res.ok ? await res.json() : [];
      } catch {
        return;
      }

      container.replaceChildren();
      if (tags.length === 0) {
        const empty = document.createElement("p");
        empty.className = "notable-tags-empty";
        empty.textContent = "No tags yet.";
        container.appendChild(empty);
        return;
      }

      const list = document.createElement("div");
      list.className = "notable-tags-list";
      for (const { tag, count } of tags) {
        const chip = document.createElement("button");
        chip.className = "notable-tags-chip";
        chip.onclick = () => api.workspace.openTag(tag);

        const label = document.createElement("span");
        label.textContent = `#${tag}`;
        chip.appendChild(label);

        const countEl = document.createElement("span");
        countEl.className = "notable-tags-chip-count";
        countEl.textContent = String(count);
        chip.appendChild(countEl);

        list.appendChild(chip);
      }
      container.appendChild(list);
    }

    api.workspace.registerSidebarPanel({
      id: "tags",
      title: "Tags",
      mount(el) {
        container = el;
        container.classList.add("notable-tags");
        void renderPanel();
        return () => {
          abort?.abort();
          container = null;
        };
      },
    });

    // Refresh the tag list whenever a note changes (created/saved tags
    // are reindexed server-side asynchronously, so this is best-effort).
    api.events.on("note:open", () => void renderPanel());
    api.events.on("note:create", () => void renderPanel());

    // --- Inline #tag chips ---------------------------------------------
    function build(view) {
      const builder = new RangeSetBuilder();
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        for (const m of text.matchAll(TAG)) {
          const [start, end] = m.indices[1];
          builder.add(from + start - 1, from + end, Decoration.mark({
            class: "cm-tag",
            attributes: { "data-tag": m[1] },
          }));
        }
      }
      return builder.finish();
    }

    const tagPlugin = ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = build(view);
        }
        update(update) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = build(update.view);
          }
        }
      },
      { decorations: (v) => v.decorations },
    );

    const clickHandler = EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const el = event.target.closest?.(".cm-tag");
        if (!el || !view.dom.contains(el)) return false;
        event.preventDefault();
        api.workspace.openTag(el.dataset.tag);
        return true;
      },
    });

    api.editor.registerExtension([tagPlugin, clickHandler]);
  },
};
