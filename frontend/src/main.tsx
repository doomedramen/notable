import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "@fontsource-variable/inter";
import "./styles/globals.css";
import { AppShell, EmptyState } from "./app/AppShell";
import { AuthGate, installAuthInterceptor } from "./app/AuthGate";
import { EditorPane } from "./app/EditorPane";
import { TagView } from "./app/TagView";
import { TrashView } from "./app/TrashView";
import { NewNote } from "./app/NewNote";
import { ShareTarget } from "./app/ShareTarget";
import { useSyncStatus } from "./store/sync-status";
import { dirtyCount, DIRTY_EVENT } from "./sync/dirty";
import { registerBuiltinCommands } from "./app/builtin-commands";
import { installHotkeys } from "./core/hotkeys";
import { loadEnabledPlugins } from "./core/plugin-loader";
import { flushIconAssignmentQueue, loadIconAssignments } from "./core/icon-assignments";

// Mitigation for Safari/iOS storage eviction: ask the browser to treat
// our origin's storage (IndexedDB) as persistent. Chrome/Firefox honor
// this broadly; Safari support is partial — which is why we ALSO track
// unsynced changes and prompt iOS users to install (see InstallPrompt).
installAuthInterceptor();

if (navigator.storage?.persist) {
  navigator.storage.persist().then((granted) => {
    console.info(`persistent storage: ${granted ? "granted" : "not granted"}`);
  });
}

// Surface "local-only changes" state in the status bar and, where
// supported, as a badge on the installed app's icon.
const setBadge = (count: number) => {
  if (!navigator.setAppBadge) return;
  if (count > 0) void navigator.setAppBadge(count);
  else void navigator.clearAppBadge?.();
};
useSyncStatus.getState().setDirty(dirtyCount());
setBadge(dirtyCount());
window.addEventListener(DIRTY_EVENT, (e) => {
  const count = (e as CustomEvent<number>).detail;
  useSyncStatus.getState().setDirty(count);
  setBadge(count);
});

registerBuiltinCommands();
installHotkeys();
// Plugins load in the background; the app never blocks on them.
void loadEnabledPlugins();
const reloadPlugins = () => void loadEnabledPlugins();
window.addEventListener("online", reloadPlugins);
window.addEventListener("notable:server-reachable", reloadPlugins);
void loadIconAssignments().then(() => flushIconAssignmentQueue());
const flushIconAssignments = () => void flushIconAssignmentQueue();
window.addEventListener("online", flushIconAssignments);
window.addEventListener("notable:server-reachable", flushIconAssignments);

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <EmptyState /> },
      { path: "note/*", element: <EditorPane /> },
      { path: "tag/*", element: <TagView /> },
      { path: "trash", element: <TrashView /> },
      { path: "new", element: <NewNote /> },
      { path: "share-target", element: <ShareTarget /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>
      <RouterProvider router={router} />
    </AuthGate>
  </React.StrictMode>,
);
