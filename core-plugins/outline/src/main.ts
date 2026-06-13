import type { EditorView } from "@codemirror/view";
import type { NotablePlugin } from "notable-plugin-api";

interface Heading {
  level: number;
  title: string;
  position: number;
}

function collectHeadings(view: EditorView | null): Heading[] {
  if (!view) return [];

  const headings: Heading[] = [];
  let fenced = false;
  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    const trimmed = line.text.trimStart();
    if (/^(```|~~~)/.test(trimmed)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (!match) continue;
    headings.push({
      level: match[1].length,
      title: match[2],
      position: line.from,
    });
  }
  return headings;
}

function style<T extends HTMLElement>(element: T, rules: Partial<CSSStyleDeclaration>): T {
  Object.assign(element.style, rules);
  return element;
}

const plugin: NotablePlugin = {
  onload(api) {
    const { view } = api.modules.codemirror;
    let host: HTMLElement | null = null;

    const render = () => {
      if (!host) return;
      host.textContent = "";
      const active = api.editor.activeView();
      const headings = collectHeadings(active);

      if (headings.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = active
          ? "This note has no headings."
          : "Open a note to see its outline.";
        style(empty, {
          margin: "0",
          padding: "16px",
          color: "var(--faint)",
          fontSize: "13px",
        });
        host.appendChild(empty);
        return;
      }

      const list = style(document.createElement("nav"), {
        display: "flex",
        flexDirection: "column",
        padding: "8px",
      });
      list.setAttribute("aria-label", "Note outline");

      for (const heading of headings) {
        const button = style(document.createElement("button"), {
          display: "block",
          width: "100%",
          padding: "6px 8px",
          paddingLeft: `${8 + (heading.level - 1) * 12}px`,
          border: "0",
          borderRadius: "var(--radius-sm)",
          background: "transparent",
          color: heading.level === 1 ? "var(--foreground)" : "var(--muted)",
          font: "inherit",
          fontSize: "13px",
          fontWeight: heading.level <= 2 ? "600" : "400",
          lineHeight: "1.35",
          textAlign: "left",
          cursor: "pointer",
        });
        button.textContent = heading.title;
        button.title = heading.title;
        button.addEventListener("mouseenter", () => {
          button.style.background = "var(--surface-hover)";
          button.style.color = "var(--foreground)";
        });
        button.addEventListener("mouseleave", () => {
          button.style.background = "transparent";
          button.style.color =
            heading.level === 1 ? "var(--foreground)" : "var(--muted)";
        });
        button.addEventListener("click", () => {
          const current = api.editor.activeView();
          if (!current) return;
          current.dispatch({
            selection: { anchor: heading.position },
            scrollIntoView: true,
          });
          current.focus();
        });
        list.appendChild(button);
      }
      host.appendChild(list);
    };

    api.workspace.registerRightPanel({
      id: "outline",
      title: "Outline",
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
      id: "outline.toggle",
      name: "Toggle note outline",
      hotkey: "Mod-Shift-O",
      run: () => api.workspace.toggleRightPanel("outline"),
    });

    api.editor.registerExtension(
      view.EditorView.updateListener.of((update) => {
        if (update.docChanged) render();
      }),
    );
    api.events.on("editor:ready", render);
    api.events.on("note:open", render);
  },
};

export default plugin;
