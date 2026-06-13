import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "@fontsource-variable/inter";
import "./styles/globals.css";
import { AppShell, EmptyState } from "./app/AppShell";
import { EditorPane } from "./app/EditorPane";
import { TagView } from "./app/TagView";
import { TrashView } from "./app/TrashView";
import { useSyncStatus } from "./store/sync-status";
import { dirtyCount, DIRTY_EVENT } from "./sync/dirty";
import { registerBuiltinCommands } from "./app/builtin-commands";
import { installHotkeys } from "./core/hotkeys";
import { loadEnabledPlugins } from "./core/plugin-loader";

// Mitigation for Safari/iOS storage eviction: ask the browser to treat
// our origin's storage (IndexedDB) as persistent. Chrome/Firefox honor
// this broadly; Safari support is partial — which is why we ALSO track
// unsynced changes and prompt iOS users to install (see InstallPrompt).
if (navigator.storage?.persist) {
  navigator.storage.persist().then((granted) => {
    console.info(`persistent storage: ${granted ? "granted" : "not granted"}`);
  });
}

// Surface "local-only changes" state in the status bar.
useSyncStatus.getState().setDirty(dirtyCount());
window.addEventListener(DIRTY_EVENT, (e) => {
  useSyncStatus.getState().setDirty((e as CustomEvent<number>).detail);
});

registerBuiltinCommands();
installHotkeys();
// Plugins load in the background; the app never blocks on them.
void loadEnabledPlugins();

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <EmptyState /> },
      { path: "note/*", element: <EditorPane /> },
      { path: "tag/*", element: <TagView /> },
      { path: "trash", element: <TrashView /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
