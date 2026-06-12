// The heart of offline-first sync.
//
// Each open note = one Y.Doc with two providers attached:
//   1. y-indexeddb  -> persists every change locally, instantly. The app
//      reads/writes ONLY through the Y.Doc, so it works fully offline.
//   2. ServerProvider (below) -> when online, streams updates to/from the
//      Rust server over WebSocket. On reconnect the client sends its full
//      state; CRDT merging makes this idempotent, so weeks of offline
//      edits converge in one exchange with no conflict dialogs.
//
// iOS-specific hardening:
//   - Edits made while disconnected mark the note "dirty" (see dirty.ts),
//     persisted so the UI can warn that the local copy is the only copy.
//     Critical because Safari can evict IndexedDB (7-day rule for
//     non-installed PWAs; disk pressure for everyone).
//   - visibilitychange triggers a reconnect: iOS suspends WebSockets when
//     the app is backgrounded, and there's no Background Sync API, so
//     foregrounding is our sync moment.

import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { markDirty, markClean } from "./dirty";

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

export class NoteConnection {
  readonly doc: Y.Doc;
  readonly text: Y.Text;
  private idb: IndexeddbPersistence;
  private ws: WebSocket | null = null;
  private retries = 0;
  private closed = false;
  private updateHandler: (update: Uint8Array, origin: unknown) => void;

  onStatus: (s: "offline" | "connecting" | "synced") => void = () => {};

  constructor(public readonly noteId: string) {
    this.doc = new Y.Doc();
    this.text = this.doc.getText("content");

    // Local persistence: available before any network.
    this.idb = new IndexeddbPersistence(`note-${noteId}`, this.doc);

    this.updateHandler = (update, origin) => {
      if (origin === this) return; // came from the server, not a local edit
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(update);
        // Note: WebSocket.send has no ack. For a scaffold we treat
        // "sent while open" as synced; a production build could add a
        // server ack frame to make markClean exact.
      } else {
        markDirty(this.noteId);
      }
    };
    this.doc.on("update", this.updateHandler);

    this.idb.whenSynced.then(() => this.connect());
    window.addEventListener("online", this.handleWake);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  private handleWake = () => {
    this.retries = 0;
    this.connect();
  };

  private handleVisibility = () => {
    // iOS suspends sockets in the background; reconnect on foreground.
    if (document.visibilityState === "visible" && this.ws?.readyState !== WebSocket.OPEN) {
      this.handleWake();
    }
  };

  private connect() {
    if (this.closed || !navigator.onLine) {
      this.onStatus("offline");
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }
    this.onStatus("connecting");

    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/api/sync/${this.noteId}`);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.retries = 0;
      // Send our full state; server's doc merges it (idempotent),
      // covering everything we wrote while offline.
      this.ws!.send(Y.encodeStateAsUpdate(this.doc));
      markClean(this.noteId);
      this.onStatus("synced");
    };

    this.ws.onmessage = (e) => {
      Y.applyUpdate(this.doc, new Uint8Array(e.data as ArrayBuffer), this);
    };

    this.ws.onclose = () => {
      this.onStatus("offline");
      if (this.closed) return;
      const delay = BACKOFF_MS[Math.min(this.retries++, BACKOFF_MS.length - 1)];
      setTimeout(() => this.connect(), delay);
    };

    this.ws.onerror = () => this.ws?.close();
  }

  destroy() {
    this.closed = true;
    window.removeEventListener("online", this.handleWake);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.doc.off("update", this.updateHandler);
    this.ws?.close();
    this.idb.destroy(); // detaches provider; data stays in IndexedDB
    this.doc.destroy();
  }
}
