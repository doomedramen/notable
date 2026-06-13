# Notable — self-hosted, offline-first notes

An Obsidian-style notes app you host yourself. **Your notes are plain
markdown files in a folder** (the vault) — grep them, back them up, sync
them, edit them with anything. A Rust single-binary server and a React
PWA add a Linear-quality interface, real-time + offline sync (CRDT),
a command palette, and runtime plugins on top.

- **Files are canonical.** The SQLite database holds only derived data
  (settings, CRDT cache, search index). Delete it and you lose no notes.
- **Offline-first.** Edits land in IndexedDB instantly and merge
  conflict-free when your server is reachable again — "offline" includes
  "away from home wifi" for a home-hosted server.
- **External edits welcome.** The server watches the vault; changes made
  by other tools merge live into open editors.
- **Plugins.** Built-in core plugins plus checksum-verified community
  plugins, themes, and icon packs from a separately published registry — see
  [docs/plugins.md](docs/plugins.md).
- **Themes.** Install configurable theme plugins or drop CSS files into a
  themes directory to restyle the app —
  see [docs/themes.md](docs/themes.md).

## Run it (Docker)

Every push to `main` publishes a multi-arch image (amd64 + arm64) to
GitHub Container Registry. A minimal `docker-compose.yml`:

```yaml
services:
  notable:
    image: ghcr.io/doomedramen/notable:latest
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data   # vault lives at ./data/vault — plain .md files
    restart: unless-stopped
```

```bash
docker compose up -d
# → http://your-server:8080  (put TLS in front; PWA install requires HTTPS)
```

Everything lives under the volume:

```
data/
  vault/      your notes (.md files & folders) — the source of truth
  plugins/    installed community plugins (one folder per plugin)
  themes/     custom CSS themes
  notable.db  derived data only (settings, CRDT cache)
```

To build locally instead: `docker compose up -d --build` with the
`docker-compose.yml` in this repo.

## Architecture

```
┌─────────────────── Browser (PWA) ────────────────────┐
│  CodeMirror 6 ←→ Y.Doc ←→ y-indexeddb (offline store) │
│  plugin runtime · command palette · Radix/Tailwind UI │
└──────────────────────────┼────────────────────────────┘
                           ↕ /api/sync/{path}  (Yjs updates)
┌─────────────────── Rust server (Axum) ────────────────┐
│  yrs Doc per open note  ──debounced──▶  vault/*.md     │
│        ▲ file watcher (external edits diffed back in)  │
│  SQLite: settings + CRDT cache (derived, disposable)   │
│  Serves embedded frontend (rust-embed, single binary)  │
└────────────────────────────────────────────────────────┘
```

**Sync strategy**
- App shell cached by a service worker → opens with no network.
- Every keystroke goes into a Y.Doc persisted to IndexedDB; when the
  server is reachable, updates stream over WebSocket and merge (CRDT,
  idempotent — no conflict dialogs).
- The server flushes doc state to the `.md` file after ~2s idle and on
  last-disconnect; the file is always the source of truth.
- Note metadata (the file listing) is cached with an offline mutation
  queue; creates pick their path client-side so replay is idempotent.

## Develop

```bash
make dev
# Frontend: http://localhost:5173
# Backend:  http://localhost:8080 (Vite proxies /api here)
```

`make dev` installs frontend dependencies when needed and runs both
processes until you press Ctrl-C. Use `make dev-backend` or
`make dev-frontend` to run either process separately.

Run the unit tests with `make test`, or run
`npm --prefix frontend run build && npm --prefix frontend run test:e2e`
for Playwright tests against the real server.

## Run modes

```bash
notable-server                  # desktop mode: starts server + opens the app
notable-server --headless       # server mode: Docker / systemd / VPS
notable-server --vault-dir ~/Notes --bind 0.0.0.0:9000
```

| Flag / env | Default | Meaning |
| --- | --- | --- |
| `--vault-dir` / `VAULT_DIR` | `./vault` | Your notes (plain .md files) |
| `--database-url` / `DATABASE_URL` | `sqlite://notable.db` | Derived data only |
| `--core-plugins-dir` / `CORE_PLUGINS_DIR` | `./core-plugins` | Immutable bundled plugins |
| `--plugins-dir` / `PLUGINS_DIR` | `./plugins` | Installed community plugins |
| `--plugin-registry-url` / `PLUGIN_REGISTRY_URL` | Notable community registry | Registry JSON URL |
| `--themes-dir` / `THEMES_DIR` | `./themes` | Custom CSS themes |
| `--auth-password` / `AUTH_PASSWORD` | _(unset, auth off)_ | Shared password protecting `/api/*` |
| `--bind` / `BIND` | `127.0.0.1:8080` | Listen address |

### Optional password protection

By default Notable has no login — anyone who can reach the port can read
and edit your vault. Setting `--auth-password` (or `AUTH_PASSWORD`) requires
a password before any `/api/*` request (including the sync WebSocket)
succeeds; the static app shell still loads so the login screen can render.

This is **LAN-protection for a single-user app, not multi-user auth**: there
is one shared password and one session cookie, valid for 30 days. Still put
a real authenticating proxy or VPN in front if exposing Notable to the
internet.

```yaml
services:
  notable:
    image: ghcr.io/doomedramen/notable:latest
    environment:
      - AUTH_PASSWORD=change-me
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
    restart: unless-stopped
```

## Project map

```
backend/
  src/main.rs        Axum router, embedded static serving, background tasks
  src/vault.rs       The vault: list/create/read/rename/delete .md files
  src/sync.rs        WebSocket rooms, file write-behind, watcher, doc cache
  src/plugins.rs     Plugin manifests + serving, enable/disable
  src/icon_assignments.rs  Synced note/folder icon metadata
  src/themes.rs      Custom theme listing + CSS serving
  src/auth.rs        Optional single-password session auth
  src/settings.rs    Generic settings KV
frontend/
  src/plugin-api/    The typed plugin API contract
  src/core/          Commands, hotkeys, workspace registries, plugin loader
  src/sync/provider.ts   Y.Doc ↔ IndexedDB ↔ WebSocket, epochs, reconnect
  src/store/notes.ts     Offline-aware vault listing with mutation queue
  src/editor/Editor.tsx  CodeMirror 6 + yCollab + plugin extensions
core-plugins/         Built-in plugins
plugins/             Installed community plugins in local development
docs/plugins.md      Plugin author guide
```

## Known gaps (roadmap)

- **Awareness/cursors** — y-protocols awareness channel for live
  multi-user cursors.

## iOS notes

iOS PWAs cannot sync in the background (no Background Sync API, no
silent push) — sync runs on open/foreground, which the local-first
design makes near-instant. Safari can also evict IndexedDB after 7 days
of inactivity for non-installed sites; Notable requests persistent
storage, tracks unsynced edits with a visible warning, and nudges iOS
users to Add to Home Screen (installed apps are exempt).
