import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "../components/ui/button";

/* autoUpdate installs new service-worker versions in the background, but
   an already-open tab keeps running the old app shell against a possibly
   newer API until reloaded. Surface that explicitly instead of letting it
   swap silently underneath the user. */
export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Pick up new versions promptly without waiting for a navigation.
      registration &&
        setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });

  if (!offlineReady && !needRefresh) return null;

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  return (
    <div
      role="status"
      className="fixed bottom-24 left-1/2 z-50 flex w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-md bg-background p-3 text-[13px] shadow-[var(--shadow-dialog)]"
    >
      <p className="m-0 flex-1">
        {needRefresh
          ? "A new version of Notable is available."
          : "Notable is ready to work offline."}
      </p>
      {needRefresh && (
        <Button size="sm" variant="primary" onClick={() => void updateServiceWorker(true)}>
          Reload
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={close}>
        Dismiss
      </Button>
    </div>
  );
}
