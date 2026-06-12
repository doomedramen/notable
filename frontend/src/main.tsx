import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Mitigation for Safari/iOS storage eviction: ask the browser to treat
// our origin's storage (IndexedDB) as persistent. Chrome/Firefox honor
// this broadly; Safari support is partial — which is why we ALSO track
// unsynced changes and prompt iOS users to install (see InstallPrompt).
if (navigator.storage?.persist) {
  navigator.storage.persist().then((granted) => {
    console.info(`persistent storage: ${granted ? "granted" : "not granted"}`);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
