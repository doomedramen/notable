import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNotesStore } from "../store/notes-store";
import { useUI } from "../store/ui";
import { quickNoteTitle } from "../core/quick-note";
import { openNote } from "../core/navigation";
import { notice } from "../components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { AppIcon } from "../components/AppIcon";

function useSoftwareKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () =>
      setVisible(window.innerHeight - viewport.height > 140);
    update();
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, []);

  return visible;
}

export function QuickNote() {
  const open = useUI((state) => state.quickNoteOpen);
  const requestedFolder = useUI((state) => state.quickNoteFolder);
  const close = useUI((state) => state.closeQuickNote);
  const lastFolder = useUI((state) => state.lastQuickNoteFolder);
  const setLastFolder = useUI((state) => state.setLastQuickNoteFolder);
  const folders = useNotesStore((state) => state.folders);
  const create = useNotesStore((state) => state.create);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [folder, setFolder] = useState("");
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setContent("");
    setSaving(false);
    const preferred = requestedFolder ?? lastFolder;
    setFolder(preferred && folders.includes(preferred) ? preferred : "");
    requestAnimationFrame(() => contentRef.current?.focus());
  }, [open]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const meta = await create(
        quickNoteTitle(title, content),
        folder,
        content,
      );
      setLastFolder(folder);
      close();
      notice("Note captured.", {
        duration: 6000,
        action: { label: "Open", run: () => openNote(meta.path) },
      });
    } catch {
      setSaving(false);
      notice("Could not save the note.", { variant: "danger" });
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        showClose={false}
        onKeyDown={handleKeyDown}
        className="bottom-0 top-auto left-0 w-full max-w-none translate-x-0 translate-y-0 rounded-b-none p-0 md:top-1/2 md:left-1/2 md:max-w-xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-md"
      >
        <div className="border-b border-border px-4 py-3 md:px-5">
          <DialogTitle>Quick Note</DialogTitle>
          <DialogDescription className="sr-only">
            Capture a note without leaving the current view.
          </DialogDescription>
        </div>
        <div className="space-y-3 px-4 py-4 md:px-5">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title (optional)"
            aria-label="Quick note title"
          />
          <textarea
            ref={contentRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Start writing…"
            aria-label="Quick note content"
            rows={8}
            className="w-full resize-none rounded-sm border border-border bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
          <label className="block text-xs font-medium text-muted">
            Folder
            <select
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              className="mt-1.5 h-8 w-full rounded-sm border border-border bg-background px-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
            >
              <option value="">Root</option>
              {folders.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex w-full items-center justify-between border-t border-border px-4 py-3 md:px-5">
            <span className="hidden text-xs text-faint sm:block">
              {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} Enter to save
            </span>
            <div className="ml-auto flex gap-2">
              <Button onClick={close}>Cancel</Button>
              <Button
                variant="primary"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save note"}
              </Button>
            </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MobileQuickNoteButton() {
  const openQuickNote = useUI((state) => state.openQuickNote);
  const keyboardVisible = useSoftwareKeyboardVisible();
  const quickNoteOpen = useUI((state) => state.quickNoteOpen);

  if (keyboardVisible || quickNoteOpen) return null;

  return (
    <button
      type="button"
      onClick={() => openQuickNote()}
      aria-label="Quick note"
      className="fixed right-4 bottom-12 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-[var(--shadow-float)] transition-[transform,opacity] active:scale-95 md:hidden"
    >
      <AppIcon icon="add" size={22} />
    </button>
  );
}
