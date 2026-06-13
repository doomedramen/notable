import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEventHandler,
  type RefObject,
} from "react";
import { cancelFeedback, triggerFeedback } from "@/core/feedback";

const EDGE_WIDTH = 40;
const ACTIVATION_DELTA = 20;
const COMMIT_PROGRESS = 0.35;
const COMMIT_VELOCITY = 0.45;
const TRANSITION_MS = 200;

type Axis = "pending" | "horizontal" | "vertical";
type GestureKind = "opening" | "closing";

interface Gesture {
  kind: GestureKind;
  id: number;
  startX: number;
  startY: number;
  axis: Axis;
  progress: number;
  previousX: number;
  previousTime: number;
  currentX: number;
  currentTime: number;
  feedbackTriggered: boolean;
}

interface VisualState {
  active: boolean;
  dragging: boolean;
  progress: number;
}

interface MobileSidebarGestureOptions {
  open: boolean;
  setOpen: (open: boolean) => void;
  disabled: boolean;
  width: number;
  contentRef: RefObject<HTMLDivElement | null>;
  /**
   * When `current` is true, a note row's long-press drag is active.
   * Edge-swipe-open and drawer-close gestures bail out (or abort a still-pending
   * candidate) so the two touch gesture systems don't fight over the same pointer.
   */
  suppressedRef?: RefObject<boolean>;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function findTouch(touches: TouchList, id: number): Touch | null {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches[index];
    if (touch?.identifier === id) return touch;
  }
  return null;
}

function hasOpenDialog(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"]') !== null;
}

export function useMobileSidebarGesture({
  open,
  setOpen,
  disabled,
  width,
  contentRef,
  suppressedRef,
}: MobileSidebarGestureOptions) {
  const [visual, setVisual] = useState<VisualState>({
    active: false,
    dragging: false,
    progress: 1,
  });
  const openRef = useRef(open);
  const disabledRef = useRef(disabled);
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const pendingProgressRef = useRef(1);

  useEffect(() => {
    openRef.current = open;
    if (!open && !gestureRef.current) {
      setVisual({ active: false, dragging: false, progress: 0 });
    }
  }, [open]);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  const clearFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  const applyProgress = useCallback((progress: number) => {
    pendingProgressRef.current = clamp(progress);
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setVisual({
        active: true,
        dragging: true,
        progress: pendingProgressRef.current,
      });
    });
  }, []);

  const finishVisual = useCallback(
    (target: 0 | 1, closeAfter: boolean) => {
      clearFrame();
      clearSettleTimer();
      gestureRef.current = null;
      pendingProgressRef.current = target;
      setVisual({ active: true, dragging: false, progress: target });
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        if (closeAfter) {
          setOpen(false);
          requestAnimationFrame(() =>
            setVisual({ active: false, dragging: false, progress: 0 }),
          );
          return;
        }
        setVisual({ active: false, dragging: false, progress: 1 });
        contentRef.current?.focus({ preventScroll: true });
      }, TRANSITION_MS);
    },
    [clearFrame, clearSettleTimer, contentRef, setOpen],
  );

  const resetGesture = useCallback(
    (keepOpen: boolean) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      if (gesture.axis === "horizontal") {
        finishVisual(keepOpen ? 1 : 0, !keepOpen);
      } else {
        gestureRef.current = null;
      }
    },
    [finishVisual],
  );

  useEffect(() => {
    const onTouchStart = (event: TouchEvent) => {
      if (
        window.innerWidth >= 768 ||
        openRef.current ||
        disabledRef.current ||
        suppressedRef?.current ||
        event.changedTouches.length === 0 ||
        hasOpenDialog()
      ) {
        return;
      }
      const touch = event.changedTouches[0];
      if (!touch || touch.clientX > EDGE_WIDTH) return;
      clearSettleTimer();
      gestureRef.current = {
        kind: "opening",
        id: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        axis: "pending",
        progress: 0,
        previousX: touch.clientX,
        previousTime: event.timeStamp,
        currentX: touch.clientX,
        currentTime: event.timeStamp,
        feedbackTriggered: false,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.kind !== "opening") return;
      if (suppressedRef?.current && gesture.axis === "pending") {
        gestureRef.current = null;
        return;
      }
      const touch = findTouch(event.changedTouches, gesture.id);
      if (!touch) return;
      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;

      if (
        gesture.axis === "pending" &&
        Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= ACTIVATION_DELTA
      ) {
        gesture.axis =
          deltaX > 0 && Math.abs(deltaX) > Math.abs(deltaY)
            ? "horizontal"
            : "vertical";
        if (gesture.axis === "horizontal") {
          setOpen(true);
          openRef.current = true;
        }
      }
      if (gesture.axis === "vertical") {
        gestureRef.current = null;
        return;
      }
      if (gesture.axis !== "horizontal") return;

      event.preventDefault();
      gesture.previousX = gesture.currentX;
      gesture.previousTime = gesture.currentTime;
      gesture.currentX = touch.clientX;
      gesture.currentTime = event.timeStamp;
      gesture.progress = clamp(deltaX / width);
      if (
        gesture.progress >= COMMIT_PROGRESS &&
        !gesture.feedbackTriggered
      ) {
        gesture.feedbackTriggered = true;
        triggerFeedback("selection");
      }
      applyProgress(gesture.progress);
    };

    const finishOpening = (event: TouchEvent, cancelled: boolean) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.kind !== "opening") return;
      if (
        event.type === "touchend" &&
        !findTouch(event.changedTouches, gesture.id)
      ) {
        return;
      }
      if (gesture.axis !== "horizontal") {
        gestureRef.current = null;
        return;
      }
      const touch = findTouch(event.changedTouches, gesture.id);
      if (touch) gesture.currentX = touch.clientX;
      gesture.currentTime = event.timeStamp;
      const elapsed = Math.max(1, gesture.currentTime - gesture.previousTime);
      const velocity = (gesture.currentX - gesture.previousX) / elapsed;
      const commit =
        !cancelled &&
        (gesture.progress >= COMMIT_PROGRESS ||
          velocity >= COMMIT_VELOCITY);
      if (cancelled) cancelFeedback();
      finishVisual(commit ? 1 : 0, !commit);
    };

    const onTouchEnd = (event: TouchEvent) => finishOpening(event, false);
    const onTouchCancel = (event: TouchEvent) => finishOpening(event, true);
    const onResize = () => {
      if (window.innerWidth < 768) return;
      gestureRef.current = null;
      clearFrame();
      clearSettleTimer();
      setOpen(false);
      setVisual({ active: false, dragging: false, progress: 0 });
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
      window.removeEventListener("resize", onResize);
    };
  }, [
    applyProgress,
    clearFrame,
    clearSettleTimer,
    finishVisual,
    setOpen,
    width,
  ]);

  useEffect(() => {
    if (!disabled || !gestureRef.current) return;
    resetGesture(openRef.current);
  }, [disabled, resetGesture]);

  useEffect(
    () => () => {
      clearFrame();
      clearSettleTimer();
    },
    [clearFrame, clearSettleTimer],
  );

  const onPointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
    if (
      window.innerWidth >= 768 ||
      !openRef.current ||
      disabledRef.current ||
      suppressedRef?.current ||
      !event.isPrimary
    ) {
      return;
    }
    clearSettleTimer();
    gestureRef.current = {
      kind: "closing",
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      axis: "pending",
      progress: 1,
      previousX: event.clientX,
      previousTime: event.timeStamp,
      currentX: event.clientX,
      currentTime: event.timeStamp,
      feedbackTriggered: false,
    };
  };

  const onPointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
    const gesture = gestureRef.current;
    if (
      !gesture ||
      gesture.kind !== "closing" ||
      gesture.id !== event.pointerId
    ) {
      return;
    }
    if (suppressedRef?.current && gesture.axis === "pending") {
      gestureRef.current = null;
      return;
    }
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (
      gesture.axis === "pending" &&
      Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= ACTIVATION_DELTA
    ) {
      gesture.axis =
        deltaX < 0 && Math.abs(deltaX) > Math.abs(deltaY)
          ? "horizontal"
          : "vertical";
      if (gesture.axis === "horizontal") {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      if (gesture.axis === "vertical") {
        gestureRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        return;
      }
    }
    if (gesture.axis !== "horizontal") return;
    event.preventDefault();
    gesture.previousX = gesture.currentX;
    gesture.previousTime = gesture.currentTime;
    gesture.currentX = event.clientX;
    gesture.currentTime = event.timeStamp;
    gesture.progress = clamp(1 + deltaX / width);
    if (
      gesture.progress <= 1 - COMMIT_PROGRESS &&
      !gesture.feedbackTriggered
    ) {
      gesture.feedbackTriggered = true;
      triggerFeedback("selection");
    }
    applyProgress(gesture.progress);
  };

  const finishClosing = (
    event: Parameters<PointerEventHandler<HTMLDivElement>>[0],
    cancelled: boolean,
  ) => {
    const gesture = gestureRef.current;
    if (
      !gesture ||
      gesture.kind !== "closing" ||
      gesture.id !== event.pointerId
    ) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (gesture.axis !== "horizontal") {
      gestureRef.current = null;
      return;
    }
    gesture.currentX = event.clientX;
    gesture.currentTime = event.timeStamp;
    const elapsed = Math.max(1, gesture.currentTime - gesture.previousTime);
    const velocity = (gesture.currentX - gesture.previousX) / elapsed;
    const commit =
      !cancelled &&
      (gesture.progress <= 1 - COMMIT_PROGRESS ||
        velocity <= -COMMIT_VELOCITY);
    if (cancelled) cancelFeedback();
    finishVisual(commit ? 0 : 1, commit);
  };

  const contentStyle: CSSProperties | undefined = visual.active
    ? {
        animation: "none",
        transform: `translateX(${(visual.progress - 1) * width}px)`,
        transition: visual.dragging
          ? "none"
          : `transform ${TRANSITION_MS}ms var(--ease-emphasized)`,
      }
    : undefined;
  const overlayStyle: CSSProperties | undefined = visual.active
    ? {
        animation: "none",
        opacity: visual.progress,
        transition: visual.dragging
          ? "none"
          : `opacity ${TRANSITION_MS}ms ease`,
      }
    : undefined;

  return {
    contentStyle,
    overlayStyle,
    gestureActive: visual.active,
    contentHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: Parameters<PointerEventHandler<HTMLDivElement>>[0]) =>
        finishClosing(event, false),
      onPointerCancel: (
        event: Parameters<PointerEventHandler<HTMLDivElement>>[0],
      ) => finishClosing(event, true),
    },
  };
}
