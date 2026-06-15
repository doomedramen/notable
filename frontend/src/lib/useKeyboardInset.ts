import { useEffect } from "react";

/**
 * Publishes the on-screen keyboard's overlap as the `--keyboard-inset` CSS
 * variable on <html>, so fixed-position surfaces can lift themselves into the
 * still-visible area when the software keyboard opens.
 *
 * Why this is needed: the app shell is `position: fixed` (see globals.css), so
 * the *layout* viewport never shrinks when iOS/Android raises the keyboard —
 * only the *visual* viewport does. Without this, centered dialogs, the command
 * palette, the settings sheet, and the editor caret all end up sitting behind
 * the keyboard. We read the gap from the VisualViewport API and expose it for
 * CSS to consume via `var(--keyboard-inset, 0px)`.
 *
 * No-op where VisualViewport is unavailable; the variable stays unset and the
 * `0px` fallbacks apply, so nothing moves.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;

    const update = () => {
      // Layout height hidden behind the keyboard (plus any accessory bar).
      // offsetTop covers the rare case where the visual viewport has itself
      // been scrolled down within the layout viewport.
      const overlap = window.innerHeight - vv.height - vv.offsetTop;
      // Ignore sub-keyboard noise (rounding, transient URL bars) so surfaces
      // don't drift a few pixels when nothing is actually covering them. A
      // real keyboard is always far taller than this floor.
      root.style.setProperty("--keyboard-inset", overlap > 60 ? `${Math.round(overlap)}px` : "0px");
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
}
