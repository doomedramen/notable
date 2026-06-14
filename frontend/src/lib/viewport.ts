/** Media query for the mobile layout. Mirrors Tailwind's `md` breakpoint
    (which applies at `min-width: 768px`), so JS and CSS agree on where the
    layout switches between the off-canvas drawer and the static sidebar. */
export const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

/** True when the viewport is in the mobile layout range. */
export function isMobileViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(MOBILE_MEDIA_QUERY).matches
  );
}
