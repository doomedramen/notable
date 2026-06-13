import type { NotablePlugin } from "notable-plugin-api";

const MAX_TITLE_LENGTH = 80;

interface Settings {
  lastFolder?: string;
}

function quickNoteTitle(title: string, content: string): string {
  const firstContentLine =
    content
      .split("\n")
      .map((line) =>
        line
          .replace(/^\s{0,3}#{1,6}\s+/, "")
          .replace(/^\s*[-*+]\s+/, "")
          .trim(),
      )
      .find(Boolean) ?? "";
  const candidate = (title.trim() || firstContentLine || "Untitled")
    .replace(/[\\/:*?"<>|#%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return candidate.slice(0, MAX_TITLE_LENGTH) || "Untitled";
}

function style<T extends HTMLElement>(element: T, rules: Partial<CSSStyleDeclaration>): T {
  Object.assign(element.style, rules);
  return element;
}

const plugin: NotablePlugin = {
  onload(api) {
    api.commands.register({
      id: "notes.new",
      name: "Quick Note",
      hotkey: "Mod-Alt-n",
      icon: "add",
      run: () => void openQuickNote(api),
    });
  },
};

async function openQuickNote(
  api: Parameters<NonNullable<NotablePlugin["onload"]>>[0],
) {
  const [folders, settings] = await Promise.all([
    api.vault.listFolders(),
    api.settings.load<Settings>(),
  ]);
  const lastFolder = settings?.lastFolder ?? "";

  let saving = false;
  let modal: { dispose(): void };

  modal = api.ui.openModal({
    title: "Quick Note",
    className: "max-w-xl",
    mount(el) {
      const container = style(document.createElement("div"), {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        marginTop: "12px",
      });

      const titleInput = style(document.createElement("input"), {
        height: "32px",
        padding: "0 10px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--background)",
        color: "var(--foreground)",
        font: "inherit",
        fontSize: "13px",
        outline: "none",
      });
      titleInput.type = "text";
      titleInput.placeholder = "Title (optional)";
      titleInput.setAttribute("aria-label", "Quick note title");

      const contentInput = style(document.createElement("textarea"), {
        resize: "none",
        padding: "10px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--background)",
        color: "var(--foreground)",
        font: "inherit",
        fontSize: "13px",
        lineHeight: "1.6",
        outline: "none",
      });
      contentInput.rows = 8;
      contentInput.placeholder = "Start writing…";
      contentInput.setAttribute("aria-label", "Quick note content");

      const folderLabel = style(document.createElement("label"), {
        display: "block",
        fontSize: "12px",
        fontWeight: "500",
        color: "var(--muted)",
      });
      folderLabel.textContent = "Folder";

      const folderSelect = style(document.createElement("select"), {
        display: "block",
        marginTop: "6px",
        height: "32px",
        width: "100%",
        padding: "0 8px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--background)",
        color: "var(--foreground)",
        font: "inherit",
        fontSize: "13px",
        outline: "none",
      });
      const rootOption = document.createElement("option");
      rootOption.value = "";
      rootOption.textContent = "Root";
      folderSelect.appendChild(rootOption);
      for (const folder of folders) {
        const option = document.createElement("option");
        option.value = folder;
        option.textContent = folder;
        folderSelect.appendChild(option);
      }
      folderSelect.value = folders.includes(lastFolder) ? lastFolder : "";
      folderLabel.appendChild(folderSelect);

      const footer = style(document.createElement("div"), {
        display: "flex",
        justifyContent: "flex-end",
        gap: "8px",
      });

      const cancelButton = style(document.createElement("button"), {
        height: "30px",
        padding: "0 12px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--background)",
        color: "var(--foreground)",
        font: "inherit",
        fontSize: "13px",
        cursor: "pointer",
      });
      cancelButton.type = "button";
      cancelButton.textContent = "Cancel";

      const saveButton = style(document.createElement("button"), {
        height: "30px",
        padding: "0 12px",
        border: "1px solid transparent",
        borderRadius: "var(--radius-sm)",
        background: "var(--accent)",
        color: "var(--accent-foreground)",
        font: "inherit",
        fontSize: "13px",
        fontWeight: "500",
        cursor: "pointer",
      });
      saveButton.type = "button";
      saveButton.textContent = "Save note";

      const close = () => modal.dispose();

      const save = async () => {
        if (saving) return;
        saving = true;
        saveButton.disabled = true;
        saveButton.textContent = "Saving…";
        try {
          const folder = folderSelect.value;
          const meta = await api.vault.create({
            name: quickNoteTitle(titleInput.value, contentInput.value),
            folder,
            content: contentInput.value,
          });
          await api.settings.save<Settings>({ lastFolder: folder });
          close();
          api.ui.notice("Note captured.", {
            duration: 6000,
            action: { label: "Open", run: () => api.workspace.openNote(meta.path) },
          });
        } catch {
          saving = false;
          saveButton.disabled = false;
          saveButton.textContent = "Save note";
          api.ui.notice("Could not save the note.", { variant: "danger" });
        }
      };

      cancelButton.addEventListener("click", () => close());
      saveButton.addEventListener("click", () => void save());
      el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void save();
        }
      });

      footer.appendChild(cancelButton);
      footer.appendChild(saveButton);

      container.appendChild(titleInput);
      container.appendChild(contentInput);
      container.appendChild(folderLabel);
      container.appendChild(footer);
      el.appendChild(container);

      requestAnimationFrame(() => contentInput.focus());

      return () => {
        el.textContent = "";
      };
    },
  });
}

export default plugin;
