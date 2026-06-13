import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
import { triggerFeedback } from "../core/feedback";

const SHEET_DISMISS_THRESHOLD = 110;

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
  const [sheetOffset, setSheetOffset] = useState(0);
  const [draggingSheet, setDraggingSheet] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const sheetOffsetRef = useRef(0);
  const sheetDrag = useRef<{
    pointerId: number;
    startY: number;
    feedbackTriggered: boolean;
  } | null>(null);
  const saveTouchRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setContent("");
    setSaving(false);
    sheetOffsetRef.current = 0;
    setSheetOffset(0);
    const preferred = requestedFolder ?? lastFolder;
    setFolder(preferred && folders.includes(preferred) ? preferred : "");
    requestAnimationFrame(() => contentRef.current?.focus());
  }, [open]);

  const save = async (fromTouch = false) => {
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
      if (fromTouch) triggerFeedback("success");
      notice("Note captured.", {
        duration: 6000,
        action: { label: "Open", run: () => openNote(meta.path) },
      });
    } catch {
      setSaving(false);
      if (fromTouch) triggerFeedback("error");
      notice("Could not save the note.", { variant: "danger" });
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  };

  const startSheetDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 768 || event.pointerType !== "touch") return;
    sheetDrag.current = {
      pointerId: event.pointerId,
      startY: event.clientY - sheetOffset,
      feedbackTriggered: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingSheet(true);
  };

  const moveSheet = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = sheetDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const offset = Math.max(0, event.clientY - drag.startY);
    if (offset >= SHEET_DISMISS_THRESHOLD && !drag.feedbackTriggered) {
      drag.feedbackTriggered = true;
      triggerFeedback("selection");
    }
    sheetOffsetRef.current = offset;
    setSheetOffset(offset);
  };

  const finishSheetDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = sheetDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    sheetDrag.current = null;
    setDraggingSheet(false);
    if (sheetOffsetRef.current >= SHEET_DISMISS_THRESHOLD) {
      close();
      return;
    }
    sheetOffsetRef.current = 0;
    setSheetOffset(0);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        showClose={false}
        onKeyDown={handleKeyDown}
        style={{
          transform:
            sheetOffset > 0 ? `translateY(${sheetOffset}px)` : undefined,
          transition: draggingSheet
            ? "none"
            : "transform var(--motion-structural) var(--ease-emphasized)",
        }}
        className="quick-note-dialog bottom-0 top-auto left-0 w-full max-w-none translate-x-0 translate-y-0 rounded-b-none p-0 md:top-1/2 md:left-1/2 md:max-w-xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-md"
      >
        <div
          className="flex h-6 touch-none items-center justify-center md:hidden"
          data-testid="quick-note-sheet-handle"
          aria-hidden
          onPointerDown={startSheetDrag}
          onPointerMove={moveSheet}
          onPointerUp={finishSheetDrag}
          onPointerCancel={finishSheetDrag}
        >
          <span className="h-1 w-9 rounded-full bg-border-strong" />
        </div>
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
                aria-busy={saving}
                onPointerDown={(event) => {
                  saveTouchRef.current = event.pointerType === "touch";
                }}
                onClick={() => {
                  const fromTouch = saveTouchRef.current;
                  saveTouchRef.current = false;
                  void save(fromTouch);
                }}
              >
                {saving && <span className="ui-spinner" aria-hidden />}
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
      onPointerDown={(event) => {
        if (event.pointerType === "touch") triggerFeedback("impact");
      }}
      aria-label="Quick note"
      className="fixed right-4 bottom-[calc(2.75rem+env(safe-area-inset-bottom))] z-30 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-[var(--shadow-float)] transition-[transform,opacity,box-shadow] hover:shadow-[var(--shadow-float-hover)] active:scale-95 active:shadow-[var(--shadow-float-pressed)] md:hidden"
    >
      <AppIcon icon="add" size={22} />
    </button>
  );
}
