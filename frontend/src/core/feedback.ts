import { WebHaptics, type HapticInput } from "web-haptics";
import { useUI } from "@/store/ui";

export type FeedbackKind =
  | "selection"
  | "impact"
  | "success"
  | "warning"
  | "error";

export const FEEDBACK_PATTERNS: Record<FeedbackKind, HapticInput> = {
  selection: "selection",
  impact: "light",
  success: "success",
  warning: "warning",
  error: "error",
};

let haptics: WebHaptics | null = null;
let cleanupInstalled = false;

function isTouchCapable(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }
  return (
    navigator.maxTouchPoints > 0 ||
    window.matchMedia?.("(pointer: coarse)").matches === true
  );
}

function destroyFeedback(): void {
  haptics?.destroy();
  haptics = null;
}

function ensureFeedback(): WebHaptics {
  if (!haptics) haptics = new WebHaptics();
  if (!cleanupInstalled) {
    cleanupInstalled = true;
    window.addEventListener("pagehide", destroyFeedback);
  }
  return haptics;
}

/** Trigger tactile feedback for a direct touch interaction when available. */
export function triggerFeedback(kind: FeedbackKind): void {
  if (!useUI.getState().hapticsEnabled || !isTouchCapable()) return;
  void ensureFeedback()
    .trigger(FEEDBACK_PATTERNS[kind])
    .catch(() => {
      // Haptics are progressive enhancement; interaction must still succeed.
    });
}

/** Stop any active pattern, for example when a gesture is cancelled. */
export function cancelFeedback(): void {
  haptics?.cancel();
}
