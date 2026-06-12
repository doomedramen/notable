# Notable — self-hosted, offline-first notes

Obsidian-style notes app. Rust single-binary server, React PWA client,
Yjs CRDT sync that works offline and merges automatically when back online.

## Architecture

```
┌─────────────────── Browser (PWA) ───────────────────┐
│  CodeMirror 6 ←→ Y.Doc ←→ y-indexeddb (offline store)│
│                    ↕ NoteConnection (WebSocket)       │
└──────────────────────────┼───────────────────────────┘
                           ↕ /api/sync/{id}  (Yjs updates)
┌─────────────────── Rust server (Axum) ───────────────┐
│  yrs Doc per room ←→ SQLite (append-only update log)  │
│  REST /api/notes  ←→ SQLite (metadata)                │
│  Serves embedded frontend (rust-embed)                │
└───────────────────────────────────────────────────────┘
```

**Offline strategy**
- App shell: cached by the service worker (vite-plugin-pwa) → app opens with no network.
- Note content: every keystroke goes into a Y.Doc persisted to IndexedDB → edits never block on the network.
- Sync: on reconnect, the client sends its full state as a Yjs update; the server merges it (CRDT, idempotent) and sends back its own state. No conflict dialogs, ever.
- Metadata (note list): cached in IndexedDB, offline creates/deletes are queued and replayed (`flushQueue`). Client-generated UUIDs make this safe.

## Develop

```bash
# Terminal 1 — server (http://localhost:8080)
cd backend
mkdir -p ../frontend/dist && touch ../frontend/dist/index.html  # placeholder for rust-embed
cargo run

# Terminal 2 — frontend with HMR (http://localhost:5173, proxies /api)
cd frontend
npm install
npm run dev
```

## Deploy

```bash
docker compose up -d --build
# → http://your-server:8080  (put TLS in front; PWA install requires HTTPS)
```

## Project map

```
backend/
  src/main.rs        Axum router, embedded static serving, SQLite pool
  src/sync.rs        WebSocket rooms, yrs doc per note, update persistence
  src/notes.rs       Note metadata REST (idempotent create for offline)
  migrations/        notes + append-only note_updates tables
frontend/
  src/sync/provider.ts   Y.Doc ↔ IndexedDB ↔ WebSocket, reconnect/backoff
  src/store/notes.ts     Offline-aware note list with mutation queue
  src/editor/Editor.tsx  CodeMirror 6 + yCollab binding
  vite.config.ts         PWA manifest + service worker config
```

## Known gaps (intentionally out of scope for the scaffold)

- **Auth** — add an auth layer (e.g. tower middleware + session cookie) before exposing publicly.
- **Update-log compaction** — `note_updates` grows unbounded; periodically squash into one snapshot.
- **Awareness/cursors** — y-protocols awareness channel for live multi-user cursors.
- **PWA icons** — drop real `icon-192.png` / `icon-512.png` into `frontend/public/`.
- **Markdown export** — walk each Y.Doc and write `.md` files for Obsidian-compatible backup.

## Run modes

```bash
notable-server                  # desktop mode: starts server + opens the app in your browser
notable-server --headless       # server mode: for Docker / systemd / VPS
notable-server --bind 0.0.0.0:9000 --database-url sqlite:///srv/notes.db
```

## Cross-platform builds

The binary is fully self-contained (frontend embedded, SQLite bundled).
Build per target — easiest with `cargo zigbuild` or `cross`:

```bash
cargo build --release --target x86_64-unknown-linux-musl   # Linux (static)
cargo build --release --target aarch64-apple-darwin        # macOS (Apple Silicon)
cargo build --release --target x86_64-pc-windows-msvc      # Windows
```

## iOS sync caveat

iOS PWAs cannot sync in the background: Safari supports neither the
Background Sync API nor silent push. Sync runs when the app is opened or
foregrounded — which the local-first design makes near-instant (a single
CRDT state exchange). Android Chrome does support Background Sync if you
want to add it for that platform. True iOS background sync requires a
native wrapper (Capacitor + BGTaskScheduler), and even that is
opportunistic rather than guaranteed.

## iOS storage-eviction mitigations

Safari can evict script-writable storage (incl. IndexedDB) after 7 days of
inactivity for sites used in the browser, and under disk pressure for
everyone. Three layers of defense are built in:

1. `navigator.storage.persist()` requested on startup (main.tsx).
2. Unsynced-edit tracking (`sync/dirty.ts`): edits made while disconnected
   mark the note dirty (persisted), and a banner warns that the local copy
   is the only copy until sync completes.
3. Install prompt (`InstallPrompt.tsx`): iOS users in Safari are nudged to
   Add to Home Screen — installed web apps are exempt from the 7-day rule.

The sync provider also reconnects on `visibilitychange`, since iOS suspends
WebSockets in the background and has no Background Sync API.
