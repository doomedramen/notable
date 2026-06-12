import { useState } from "react";

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
    () => localStorage.getItem(DISMISS_KEY) === "1"
  );

  if (dismissed || !isIOSSafariNotInstalled()) return null;

  return (
    <div className="install-prompt" role="note">
      <strong>Protect your offline notes:</strong> add this app to your Home
      Screen. iOS can delete browser-stored data after 7 days of inactivity —
      installed apps are exempt. Tap <span aria-label="Share">Share</span> →{" "}
      <em>Add to Home Screen</em>.
      <button
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setDismissed(true);
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
