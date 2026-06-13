import type { NotablePlugin } from "notable-plugin-api";

const MAX_RECENT_FILES = 12;

interface Settings {
  recent?: unknown;
}

function noteName(path: string): string {
  const filename = path.split("/").pop() ?? path;
  return filename.replace(/\.md$/i, "");
}

function noteFolder(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function style<T extends HTMLElement>(element: T, rules: Partial<CSSStyleDeclaration>): T {
  Object.assign(element.style, rules);
  return element;
}

const plugin: NotablePlugin = {
  async onload(api) {
    const saved = (await api.settings.load<Settings>()) ?? {};
    let recent: string[] = Array.isArray(saved.recent)
      ? saved.recent
          .filter((path): path is string => typeof path === "string")
          .slice(0, MAX_RECENT_FILES)
      : [];
    let host: HTMLElement | null = null;

    const save = () => {
      void api.settings.save({ recent }).catch((error) => {
        console.error("[recent-files] could not save history", error);
      });
    };

    const render = () => {
      if (!host) return;
      host.textContent = "";

      if (recent.length === 0) {
        const empty = style(document.createElement("p"), {
          margin: "0",
          padding: "16px",
          color: "var(--faint)",
          fontSize: "13px",
        });
        empty.textContent = "Recently opened notes will appear here.";
        host.appendChild(empty);
        return;
      }

      const list = style(document.createElement("nav"), {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        padding: "8px",
      });
      list.setAttribute("aria-label", "Recent files");

      for (const path of recent) {
        const button = style(document.createElement("button"), {
          display: "block",
          width: "100%",
          padding: "7px 8px",
          border: "0",
          borderRadius: "var(--radius-sm)",
          background: "transparent",
          color: "var(--foreground)",
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
        });
        button.title = path;
        button.addEventListener("mouseenter", () => {
          button.style.background = "var(--surface-hover)";
        });
        button.addEventListener("mouseleave", () => {
          button.style.background = "transparent";
        });
        button.addEventListener("click", () => api.workspace.openNote(path));

        const title = style(document.createElement("div"), {
          overflow: "hidden",
          fontSize: "13px",
          fontWeight: "500",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        });
        title.textContent = noteName(path);
        button.appendChild(title);

        const folder = noteFolder(path);
        if (folder) {
          const detail = style(document.createElement("div"), {
            overflow: "hidden",
            marginTop: "2px",
            color: "var(--faint)",
            fontSize: "11px",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          });
          detail.textContent = folder;
          button.appendChild(detail);
        }
        list.appendChild(button);
      }
      host.appendChild(list);
    };

    const record = (path: string) => {
      recent = [path, ...recent.filter((candidate) => candidate !== path)].slice(
        0,
        MAX_RECENT_FILES,
      );
      render();
      save();
    };

    api.workspace.registerRightPanel({
      id: "recent-files",
      title: "Recent files",
      mount(element) {
        host = element;
        render();
        return () => {
          if (host === element) host = null;
          element.textContent = "";
        };
      },
    });

    api.commands.register({
      id: "recent-files.toggle",
      name: "Toggle recent files",
      hotkey: "Mod-Shift-E",
      run: () => api.workspace.toggleRightPanel("recent-files"),
    });

    api.events.on("note:open", record);
    api.events.on("note:delete", (path) => {
      const next = recent.filter((candidate) => candidate !== path);
      if (next.length === recent.length) return;
      recent = next;
      render();
      save();
    });

    const active = api.vault.activeNoteId();
    if (active) record(active);
  },
};

export default plugin;
