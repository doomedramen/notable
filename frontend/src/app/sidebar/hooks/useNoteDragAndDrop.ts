import {
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { triggerFeedback } from "../../../core/feedback";
import { preserveEditorFocusForNavigation } from "../../../core/editor";

const LONG_PRESS_MS = 280;
const CANCEL_THRESHOLD_PX = 12;

interface TouchDragState {
  path: string;
  active: boolean;
  timer: number;
  targetFolder: string | null;
  startX: number;
  startY: number;
}

export interface NoteDragHandlers {
  draggable: true;
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

/**
 * Unifies desktop HTML5 drag-and-drop and the mobile long-press drag used to
 * move a note into a folder. `navRef` is the scroll container the touch drag
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
  noteDragActiveRef,
}: {
  navRef: RefObject<HTMLElement | null>;
  onMoveNote: (path: string, folder: string) => void;
  noteDragActiveRef: RefObject<boolean>;
}) {
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const touchDragRef = useRef<TouchDragState | null>(null);

  const endDrag = () => {
    setDraggedPath(null);
    setDragOverFolder(null);
  };

  const finishTouchDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = touchDragRef.current;
    if (!drag) return;
    clearTimeout(drag.timer);
    if (drag.active) {
      event.preventDefault();
      event.stopPropagation();
      if (drag.targetFolder !== null) onMoveNote(drag.path, drag.targetFolder);
    }
    touchDragRef.current = null;
    noteDragActiveRef.current = false;
    endDrag();
  };

  const getNoteDragHandlers = (path: string): NoteDragHandlers => ({
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/notable-note", path);
      setDraggedPath(path);
    },
    onDragEnd: endDrag,
    onPointerDown: (event) => {
      preserveEditorFocusForNavigation();
      if (event.pointerType !== "touch") return;
      const drag: TouchDragState = {
        path,
        active: false,
        targetFolder: null,
        startX: event.clientX,
        startY: event.clientY,
        timer: window.setTimeout(() => {
          drag.active = true;
          noteDragActiveRef.current = true;
          setDraggedPath(path);
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
      drag.targetFolder = folder ?? null;
      setDragOverFolder(folder ?? null);
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

  const getFolderDropHandlers = (folder: string): FolderDropHandlers => ({
    "data-folder-drop": folder,
    onDragOver: (event) => {
      event.preventDefault();
      setDragOverFolder(folder);
    },
    onDragLeave: () => setDragOverFolder(null),
    onDrop: (event) => {
      event.preventDefault();
      const path =
        event.dataTransfer.getData("text/notable-note") || draggedPath;
      if (path) onMoveNote(path, folder);
      endDrag();
    },
  });

  return { draggedPath, dragOverFolder, getNoteDragHandlers, getFolderDropHandlers };
}
