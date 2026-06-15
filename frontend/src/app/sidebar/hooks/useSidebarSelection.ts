import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { openNote } from "@/core/navigation";
import { useUI } from "@/store/ui";
import type { NoteMeta } from "@/store/notes";

/**
 * Multi-select state for the sidebar note list: a `Set` of selected paths
 * plus an anchor path used for shift-click range selection. `noteOrder` is
 * the flattened display order of note paths (root notes first, then each
 * folder's notes in order), used to compute shift-click ranges.
 */
export function useSidebarSelection(noteOrder: string[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const handleNoteClick = useCallback(
    (note: NoteMeta, event: MouseEvent) => {
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(note.path)) next.delete(note.path);
          else next.add(note.path);
          return next;
        });
        setSelectionAnchor(note.path);
        return;
      }
      if (event.shiftKey && selectionAnchor) {
        event.preventDefault();
        const from = noteOrder.indexOf(selectionAnchor);
        const to = noteOrder.indexOf(note.path);
        if (from === -1 || to === -1) {
          setSelected(new Set([note.path]));
        } else {
          const [start, end] = from < to ? [from, to] : [to, from];
          setSelected(new Set(noteOrder.slice(start, end + 1)));
        }
        return;
      }
      setSelected(new Set());
      setSelectionAnchor(note.path);
      openNote(note.path);
      // On mobile, selecting a note should reveal it. Navigation closes the
      // drawer when the active note *changes*, but tapping the already-open
      // note doesn't navigate — close it here so the tap isn't a no-op.
      const ui = useUI.getState();
      if (ui.mobileSidebarOpen) ui.setMobileSidebarOpen(false);
    },
    [noteOrder, selectionAnchor],
  );

  /** Selected paths for context-menu callbacks, with `path` always first. */
  const selectionFor = useCallback(
    (path: string): string[] =>
      selected.has(path) ? [path, ...[...selected].filter((p) => p !== path)] : [path],
    [selected],
  );

  const ensureSelected = useCallback(
    (path: string) => {
      if (!selected.has(path)) {
        setSelected(new Set([path]));
        setSelectionAnchor(path);
      }
    },
    [selected],
  );

  useEffect(() => {
    if (selected.size === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected.size, clearSelection]);

  // Drop selected paths (and a stale anchor) once their notes disappear —
  // e.g. after a trash, move, or rename — so selection can't dangle.
  useEffect(() => {
    const valid = new Set(noteOrder);
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const path of prev) {
        if (valid.has(path)) next.add(path);
        else changed = true;
      }
      return changed ? next : prev;
    });
    setSelectionAnchor((prev) => (prev === null || valid.has(prev) ? prev : null));
  }, [noteOrder]);

  return {
    selected,
    selectionFor,
    handleNoteClick,
    ensureSelected,
    clearSelection,
  };
}
