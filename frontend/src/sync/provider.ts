// The heart of offline-first sync.
//
// Each open note = one Y.Doc with two providers attached:
//   1. y-indexeddb  -> persists every change locally, instantly. The app
//      reads/writes ONLY through the Y.Doc, so it works fully offline.
//   2. ServerProvider (below) -> when reachable, streams updates to/from
//      the Rust server over WebSocket. On reconnect the client sends its
//      full state; CRDT merging makes this idempotent, so weeks of
//      offline edits converge in one exchange with no conflict dialogs.
//
// "Offline" here means "can't reach OUR server" (a home-hosted vault is
// unreachable from outside the LAN even with full internet) — the status
// is driven by the WebSocket, not navigator.onLine.
//
// Doc epochs: the server's first frame is {"guid"}. The guid changes if
// the server's CRDT cache was rebuilt (DB deleted) — local Yjs history
// is then incompatible (merging would duplicate text). The client backs
// up dirty local text as a conflict note, resets local state, and
// reloads from the server.
//
// iOS-specific hardening:
//   - Edits made while disconnected mark the note "dirty" (see dirty.ts),
//     persisted so the UI can warn that the local copy is the only copy.
//   - visibilitychange triggers a reconnect: iOS suspends WebSockets when
//     the app is backgrounded, and there's no Background Sync API, so
//     foregrounding is our sync moment.

import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { dirtyContent, markDirty, markClean, isDirty } from "./dirty";
import { encodePath } from "@/store/notes";

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

export class NoteConnection {
  readonly doc: Y.Doc;
  readonly text: Y.Text;
  readonly ready: Promise<void>;
  private idb: IndexeddbPersistence;
  private ws: WebSocket | null = null;
  private retries = 0;
  private closed = false;
  private resetting = false;
  private updateHandler: (update: Uint8Array, origin: unknown) => void;

  onStatus: (s: "offline" | "connecting" | "synced") => void = () => {};
  /** Local CRDT state was discarded (doc epoch changed) — remount me. */
  onReset: () => void = () => {};

  constructor(
    public readonly path: string,
    initialContent: Promise<string | null> = Promise.resolve(null),
  ) {
    this.doc = new Y.Doc();
    this.text = this.doc.getText("content");

    // Local persistence: available before any network.
    this.idb = new IndexeddbPersistence(`note-${path}`, this.doc);

    this.updateHandler = (update, origin) => {
      // Ignore non-edits: server echoes (origin === this) and IndexedDB
      // hydration on boot (origin === idb). Treating hydration as a local
      // edit would, while offline, overwrite the dirty-content recovery
      // copy with the partially-hydrated doc — losing the newest edits.
      if (origin === this || origin === this.idb) return;
      if (navigator.onLine && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(update);
        // Note: WebSocket.send has no ack. For a scaffold we treat
        // "sent while open" as synced; a production build could add a
        // server ack frame to make markClean exact.
      } else {
        markDirty(this.path, this.text.toString());
      }
    };
    this.doc.on("update", this.updateHandler);

    this.ready = this.idb.whenSynced.then(async () => {
      const pending = await initialContent;
      if (pending && this.text.length === 0) {
        this.text.insert(0, pending);
      }
      this.restoreDirtyContent();
      this.connect();
    });
    window.addEventListener("online", this.handleWake);
    window.addEventListener("offline", this.handleOffline);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  private handleOffline = () => {
    // Reflect known-offline immediately instead of waiting for the
    // socket to time out; closing it routes edits to markDirty.
    this.onStatus("offline");
    this.ws?.close();
  };

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

  private restoreDirtyContent() {
    const content = dirtyContent(this.path);
    if (content === null || content === this.text.toString()) return;

    // The recovery copy is authoritative while dirty. Apply it only after
    // IndexedDB hydration so a stale asynchronous restore cannot replace it.
    this.doc.transact(() => {
      if (this.text.length > 0) {
        this.text.delete(0, this.text.length);
      }
      if (content) {
        this.text.insert(0, content);
      }
    }, this);
  }

  /** First server frame: doc epoch check. Returns false if we must reset. */
  private handleHello(guid: string): boolean {
    const key = `notable-guid:${this.path}`;
    const stored = localStorage.getItem(key);
    if (stored && stored !== guid) {
      this.resetting = true;
      const localText = this.text.toString();
      const hadDirtyEdits = isDirty(this.path);
      localStorage.setItem(key, guid);
      this.ws?.close();
      void (async () => {
        if (hadDirtyEdits && localText.trim()) {
          // Local-only edits exist on an incompatible history: preserve
          // them as a sibling conflict file (Syncthing-style), then reset.
          const name = this.path.split("/").pop()!.replace(/\.md$/, "");
          const folder = this.path.includes("/")
            ? this.path.slice(0, this.path.lastIndexOf("/"))
            : "";
          await fetch("/api/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: `${name} (conflict)`,
              folder,
              content: localText,
            }),
          }).catch(() => {});
        }
        markClean(this.path);
        await this.idb.clearData().catch(() => {});
        this.onReset();
      })();
      return false;
    }
    localStorage.setItem(key, guid);
    return true;
  }

  private connect() {
    if (this.closed || this.resetting || !navigator.onLine) {
      this.onStatus("offline");
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }
    this.onStatus("connecting");

    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/api/sync/${encodePath(this.path)}`);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.retries = 0;
      // Let the rest of the app know the server is reachable. The
      // metadata queue listens for this.
      window.dispatchEvent(new Event("notable:server-reachable"));
    };

    this.ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        // Hello frame ({"guid"}). Only after it checks out do we push
        // our full state (covering everything written while offline).
        try {
          const { guid } = JSON.parse(e.data) as { guid: string };
          if (this.handleHello(guid)) {
            this.ws?.send(Y.encodeStateAsUpdate(this.doc));
            markClean(this.path);
            this.onStatus("synced");
          }
        } catch {
          /* malformed hello — treat as plain message */
        }
        return;
      }
      if (this.resetting) return;
      Y.applyUpdate(this.doc, new Uint8Array(e.data as ArrayBuffer), this);
    };

    this.ws.onclose = () => {
      this.onStatus("offline");
      if (this.closed || this.resetting) return;
      const delay = BACKOFF_MS[Math.min(this.retries++, BACKOFF_MS.length - 1)];
      setTimeout(() => this.connect(), delay);
    };

    this.ws.onerror = () => this.ws?.close();
  }

  destroy() {
    this.closed = true;
    window.removeEventListener("online", this.handleWake);
    window.removeEventListener("offline", this.handleOffline);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.doc.off("update", this.updateHandler);
    this.ws?.close();
    if (!this.resetting) {
      this.idb.destroy(); // detaches provider; data stays in IndexedDB
    }
    this.doc.destroy();
  }
}
