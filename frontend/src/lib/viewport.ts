import { useSyncExternalStore } from "react";

/** Media query for the mobile layout. Mirrors Tailwind's `md` breakpoint
    (which applies at `min-width: 768px`), so JS and CSS agree on where the
    layout switches between the off-canvas drawer and the static sidebar. */
export const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

/** True when the viewport is in the mobile layout range. Non-reactive — use
    inside event handlers / one-off checks. For render-time use `useIsMobile`. */
export function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

/** Reactive mobile-layout flag. Single source of truth for the `md`
    breakpoint across components (sidebar, settings, gestures). */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileViewport, () => false);
}
