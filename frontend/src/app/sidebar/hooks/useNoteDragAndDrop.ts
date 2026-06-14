import {
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { triggerFeedback } from "@/core/feedback";
import { preserveEditorFocusForNavigation } from "@/core/editor";

const LONG_PRESS_MS = 280;
const CANCEL_THRESHOLD_PX = 12;

type DragKind = "note" | "folder";

interface TouchDragState {
  kind: DragKind;
  path: string;
  active: boolean;
  timer: number;
  targetFolder: string | null;
  startX: number;
  startY: number;
}

export interface ItemDragHandlers {
  draggable: true;
  onClickCapture: (event: MouseEvent<HTMLButtonElement>) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
}

export interface FolderDropHandlers {
  "data-folder-drop": string;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

const NOTE_MIME = "text/notable-note";
const FOLDER_MIME = "text/notable-folder";

/** A folder can't be dropped onto itself or one of its own descendants. */
function folderDropAllowed(
  folder: string,
  dragged: { kind: DragKind; path: string } | null,
): boolean {
  if (!dragged) return false;
  if (dragged.kind === "folder") {
    if (folder === dragged.path) return false;
    if (folder.startsWith(`${dragged.path}/`)) return false;
  }
  return true;
}

/**
 * Unifies desktop HTML5 drag-and-drop and the mobile long-press drag used to
 * move notes and folders (which can be nested inside other folders) around
 * the sidebar tree. `navRef` is the scroll container the touch drag
 * auto-scrolls while dragging near its edges.
 *
 * `noteDragActiveRef` is shared with `useMobileSidebarGesture`: while a
 * long-press drag is active, the drawer's open/close swipe gesture is
 * suppressed so the two touch gesture systems can't fight over the same
 * pointer sequence.
 */
export function useNoteDragAndDrop({
  navRef,
  onMoveNote,
  onMoveFolder,
  noteDragActiveRef,
}: {
  navRef: RefObject<HTMLElement | null>;
  onMoveNote: (path: string, folder: string) => void;
  onMoveFolder: (path: string, folder: string) => void;
  noteDragActiveRef: RefObject<boolean>;
}) {
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [draggedKind, setDraggedKind] = useState<DragKind | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const touchDragRef = useRef<TouchDragState | null>(null);
  // Set when a touch drag ends so the click the browser synthesizes from the
  // same pointer sequence can be swallowed instead of opening the note.
  const suppressNextClickRef = useRef(false);

  const dragged = draggedPath && draggedKind ? { kind: draggedKind, path: draggedPath } : null;

  const endDrag = () => {
    setDraggedPath(null);
    setDraggedKind(null);
    setDragOverFolder(null);
  };

  const finishTouchDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = touchDragRef.current;
    if (!drag) return;
    clearTimeout(drag.timer);
    if (drag.active) {
      suppressNextClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      if (drag.targetFolder !== null) {
        if (drag.kind === "folder") onMoveFolder(drag.path, drag.targetFolder);
        else onMoveNote(drag.path, drag.targetFolder);
      }
    }
    touchDragRef.current = null;
    noteDragActiveRef.current = false;
    endDrag();
  };

  const getDragHandlers = (kind: DragKind, path: string): ItemDragHandlers => ({
    draggable: true,
    onClickCapture: (event) => {
      if (!suppressNextClickRef.current) return;
      suppressNextClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(kind === "folder" ? FOLDER_MIME : NOTE_MIME, path);
      setDraggedPath(path);
      setDraggedKind(kind);
    },
    onDragEnd: endDrag,
    onPointerDown: (event) => {
      // A fresh interaction starts; never carry a stale suppress flag into it.
      suppressNextClickRef.current = false;
      preserveEditorFocusForNavigation();
      if (event.pointerType !== "touch") return;
      const drag: TouchDragState = {
        kind,
        path,
        active: false,
        targetFolder: null,
        startX: event.clientX,
        startY: event.clientY,
        timer: window.setTimeout(() => {
          drag.active = true;
          noteDragActiveRef.current = true;
          setDraggedPath(path);
          setDraggedKind(kind);
          triggerFeedback("impact");
        }, LONG_PRESS_MS),
      };
      touchDragRef.current = drag;
    },
    onPointerMove: (event) => {
      const drag = touchDragRef.current;
      if (
        drag &&
        !drag.active &&
        Math.hypot(
          event.clientX - drag.startX,
          event.clientY - drag.startY,
        ) >= CANCEL_THRESHOLD_PX
      ) {
        clearTimeout(drag.timer);
        touchDragRef.current = null;
        return;
      }
      if (!drag?.active) return;
      event.preventDefault();
      event.stopPropagation();
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-folder-drop]");
      const folder = target?.dataset.folderDrop;
      const allowed =
        folder !== undefined &&
        folderDropAllowed(folder, { kind: drag.kind, path: drag.path });
      drag.targetFolder = allowed ? folder : null;
      setDragOverFolder(allowed ? folder : null);
      const nav = navRef.current;
      if (nav) {
        const bounds = nav.getBoundingClientRect();
        if (event.clientY < bounds.top + 48) nav.scrollTop -= 12;
        if (event.clientY > bounds.bottom - 48) nav.scrollTop += 12;
      }
    },
    onPointerUp: finishTouchDrag,
    onPointerCancel: finishTouchDrag,
  });

  const getNoteDragHandlers = (path: string) => getDragHandlers("note", path);
  const getFolderDragHandlers = (path: string) => getDragHandlers("folder", path);

  const getFolderDropHandlers = (folder: string): FolderDropHandlers => ({
    "data-folder-drop": folder,
    onDragOver: (event) => {
      if (!folderDropAllowed(folder, dragged)) return;
      event.preventDefault();
      setDragOverFolder(folder);
    },
    onDragLeave: () => setDragOverFolder(null),
    onDrop: (event) => {
      event.preventDefault();
      const folderPath =
        event.dataTransfer.getData(FOLDER_MIME) ||
        (draggedKind === "folder" ? draggedPath : "");
      const notePath =
        event.dataTransfer.getData(NOTE_MIME) ||
        (draggedKind === "note" ? draggedPath : "");
      if (folderPath && folderDropAllowed(folder, { kind: "folder", path: folderPath })) {
        onMoveFolder(folderPath, folder);
      } else if (notePath) {
        onMoveNote(notePath, folder);
      }
      endDrag();
    },
  });

  return {
    draggedPath,
    draggedKind,
    dragOverFolder,
    getNoteDragHandlers,
    getFolderDragHandlers,
    getFolderDropHandlers,
  };
}
