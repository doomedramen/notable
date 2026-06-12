import { useState } from "react";
import { X } from "lucide-react";

// On iOS, installing to the Home Screen isn't cosmetic — per WebKit's
// ITP policy, installed web apps are exempt from the 7-day storage
// eviction that applies to sites used in the Safari browser. For a
// notes app, that's the difference between "offline cache" and
// "data loss risk", so we frame the prompt around protecting notes.

const DISMISS_KEY = "notable-install-dismissed";

function isIOSSafariNotInstalled(): boolean {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const installed =
    (navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  return isIOS && !installed;
}

export function InstallPrompt() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "1",
  );

  if (dismissed || !isIOSSafariNotInstalled()) return null;

  return (
    <div
      role="note"
      className="fixed bottom-10 left-1/2 z-50 flex w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-2 rounded-md bg-background p-3 text-[13px] leading-relaxed shadow-[var(--shadow-dialog)]"
    >
      <p className="m-0 flex-1">
        <strong className="text-accent">Protect your offline notes:</strong>{" "}
        add this app to your Home Screen. iOS can delete browser-stored data
        after 7 days of inactivity — installed apps are exempt. Tap{" "}
        <span aria-label="Share">Share</span> → <em>Add to Home Screen</em>.
      </p>
      <button
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setDismissed(true);
        }}
        aria-label="Dismiss"
        className="rounded-sm p-0.5 text-faint hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
}
