// Core Notable plugin: backlinks panel.
//
// Shows every note that links to the currently open note, via the
// server-side link index (GET /api/backlinks/{path}).
import type { NotablePlugin } from "notable-plugin-api";

interface BacklinkHit {
  source_path: string;
  source_name: string;
  context?: string;
}

const plugin: NotablePlugin = {
  onload(api) {
    let container: HTMLElement | null = null;
    let abort: AbortController | null = null;

    async function render() {
      if (!container) return;
      const path = api.vault.activeNoteId();
      if (!path) {
        container.replaceChildren();
        const empty = document.createElement("p");
        empty.className = "notable-backlinks-empty";
        empty.textContent = "Open a note to see its backlinks.";
        container.appendChild(empty);
        return;
      }

      abort?.abort();
      abort = new AbortController();
      let hits: BacklinkHit[];
      try {
        const res = await fetch(`/api/backlinks/${path.split("/").map(encodeURIComponent).join("/")}`, {
          signal: abort.signal,
        });
        hits = res.ok ? await res.json() : [];
      } catch {
        return;
      }

      container.replaceChildren();
      if (hits.length === 0) {
        const empty = document.createElement("p");
        empty.className = "notable-backlinks-empty";
        empty.textContent = "No notes link here yet.";
        container.appendChild(empty);
        return;
      }

      const list = document.createElement("ul");
      list.className = "notable-backlinks-list";
      for (const hit of hits) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.className = "notable-backlinks-item";
        button.onclick = () => api.workspace.openNote(hit.source_path);

        const title = document.createElement("div");
        title.className = "notable-backlinks-title";
        title.textContent = hit.source_name;
        button.appendChild(title);

        if (hit.context) {
          const context = document.createElement("div");
          context.className = "notable-backlinks-context";
          context.textContent = hit.context;
          button.appendChild(context);
        }

        item.appendChild(button);
        list.appendChild(item);
      }
      container.appendChild(list);
    }

    injectStyles();

    api.workspace.registerRightPanel({
      id: "backlinks",
      title: "Backlinks",
      mount(el) {
        container = el;
        container.classList.add("notable-backlinks");
        void render();
        return () => {
          abort?.abort();
          container = null;
        };
      },
    });

    api.events.on("note:open", () => void render());
    api.events.on("editor:ready", () => void render());

    api.workspace.registerStatusBarItem({
      id: "backlinks-toggle",
      mount(el) {
        const button = document.createElement("button");
        button.className = "notable-backlinks-toggle";
        button.setAttribute("aria-label", "Toggle backlinks panel");
        button.textContent = "Backlinks";
        button.onclick = () => api.workspace.toggleRightPanel("backlinks");
        el.appendChild(button);
        return () => el.removeChild(button);
      },
    });
  },
};

export default plugin;

const STYLE_ID = "notable-backlinks-style";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .notable-backlinks-empty {
      padding: 0.5rem 0.75rem;
      font-size: 12px;
      color: var(--faint);
    }
    .notable-backlinks-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 0.25rem;
    }
    .notable-backlinks-item {
      display: block;
      width: 100%;
      text-align: left;
      padding: 0.4rem 0.5rem;
      border-radius: 0.375rem;
      background: transparent;
      border: none;
      cursor: pointer;
    }
    .notable-backlinks-item:hover {
      background: var(--surface-hover);
    }
    .notable-backlinks-title {
      font-size: 13px;
      color: var(--foreground);
      font-weight: 500;
    }
    .notable-backlinks-context {
      margin-top: 2px;
      font-size: 12px;
      color: var(--faint);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .notable-backlinks-toggle {
      background: transparent;
      border: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
      padding: 0;
    }
    .notable-backlinks-toggle:hover {
      color: var(--accent);
    }
  `;
  document.head.appendChild(style);
}
