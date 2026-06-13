# Notable plugin API v3

API v3 gives plugins a supported path for operations that previously required
undocumented HTTP requests. Its core rule is simple: use the plugin API instead
of calling `/api/*` directly. The API keeps the sidebar store, offline mutation
queue, Yjs rooms, search index, icon assignments, and lifecycle events in sync.

Set `"apiVersion": 3` in the plugin manifest to require these capabilities.
Older API v1/v2 plugins remain compatible.

## Vault lifecycle

`api.vault` manages note and folder metadata through the same offline-aware
store used by Notable's own interface.

```js
const note = await api.vault.create({
  path: "Projects/Launch.md",
  content: "# Launch\n\nInitial plan",
});

await api.vault.rename(note.path, "Projects/Release.md");
await api.vault.createFolder("Projects/Archive");
await api.vault.renameFolder("Projects/Archive", "Archive/Projects");
await api.vault.trash("Projects/Release.md");
```

Available operations:

| Method | Behavior |
| --- | --- |
| `list()` | Return cached note metadata, refreshing on first use |
| `listFolders()` | Return cached vault-relative folder paths |
| `refresh()` | Reconcile metadata with the server and emit `vault:refresh` |
| `stat(path)` | Return cached note metadata or `null` |
| `exists(path)` | Test whether a note is present in the metadata store |
| `create(options)` | Create a note by path or by free name/folder |
| `rename(from, to)` | Rename or move a note |
| `trash(path)` | Soft-delete a note |
| `delete(path)` | Permanently delete a note |
| `createFolder(path)` | Create a folder, including parents |
| `renameFolder(from, to)` | Move a folder tree |
| `deleteFolder(path)` | Delete an empty folder tree |
| `activeNoteId()` | Return the active note path or `null` |

Paths are vault-relative, slash-separated, and cannot contain traversal or
hidden segments. Note paths end in `.md`. `create(name, folder)` remains
available for API v1/v2 source compatibility, but new plugins should use the
object form.

Metadata mutations are optimistic and queued when the Notable server cannot be
reached. A note created offline with `content` stages that text for its first
editor and carries it in the queued server mutation.

## Documents

Note text belongs to a Yjs document, not directly to the file endpoint.
`api.documents` preserves that model for plugins:

```js
const snapshot = await api.documents.read("Projects/Plan.md");

try {
  await api.documents.applyEdits(
    snapshot.path,
    [{ from: snapshot.text.length, to: snapshot.text.length, insert: "\nDone" }],
    { expectedRevision: snapshot.revision },
  );
} catch (error) {
  if (error?.code === "CONFLICT") {
    api.ui.notice("The note changed. Read it again before retrying.");
  }
}
```

`read(path)` returns `{ path, text, revision }`. Revisions are opaque; plugins
must not parse or generate them. Pass the value back as `expectedRevision` to
make a write conditional on the document still matching the snapshot.

`replace(path, text, options)` replaces the full text. `applyEdits(path, edits,
options)` accepts sorted, non-overlapping CodeMirror-style ranges. Offsets are
UTF-16 positions, matching JavaScript strings and CodeMirror.

For the active note, reads and writes use the local editor buffer and therefore
work offline. Inactive notes use the server-side CRDT room so writes merge into
Yjs history, update connected editors, persist the Markdown file, and refresh
the search index. Reading or writing an inactive note while the server is
unreachable rejects with `OFFLINE`; returning stale or empty content would be
unsafe.

Do not use `fetch("/api/notes/...")` to modify note text. A raw file write can
race an open Yjs room and bypass connected editors.

## Search and graph

`api.search` wraps the derived server index:

```js
const hits = await api.search.query("release checklist", { limit: 10 });
const incoming = await api.search.backlinks("Projects/Release.md");
const outgoing = await api.search.outgoingLinks("Projects/Release.md");
const tags = await api.search.tags();
const roadmap = await api.search.notesWithTag("roadmap");
```

Search limits default to 20 and must be between 1 and 100. Search excerpts are
plain text; `\u0001` and `\u0002` delimit matched spans for safe highlighting.
Outgoing links include unresolved wikilinks with `path: null`.

The search index is derived from Markdown files. Results can briefly lag an
active editor until its room flushes.

## Lifecycle events

All subscriptions return a disposable and are also cleaned up automatically
when the plugin unloads.

```js
api.events.on("note:rename", ({ from, to }) => {
  console.info("renamed", from, to);
});

api.events.on("note:change", ({ path, source }) => {
  // source is "editor" or "plugin"
});
```

API v3 events:

| Event | Payload |
| --- | --- |
| `note:create` | `NoteMeta` |
| `note:rename` | `{ from, to, meta }` |
| `note:delete` | Note path |
| `note:change` | `{ path, source }` |
| `folder:create` / `folder:delete` | Folder path |
| `folder:rename` | `{ from, to }` |
| `vault:refresh` | `{ notes, folders }` |
| `editor:ready` / `editor:destroy` | Host `EditorView` |
| `editor:selection-change` | Path and main selection offsets |

`note:change` describes changes observed in this browser. It is not a durable
server webhook. An editor change may originate locally or from a remote CRDT
peer; plugins that perform expensive work should debounce the event.

## Errors and concurrency

Asynchronous API failures are `Error` objects with a stable `code`:

| Code | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Invalid path, range, or option |
| `NOT_FOUND` | The requested resource does not exist |
| `CONFLICT` | A path is occupied or a document revision is stale |
| `OFFLINE` | The operation requires the unavailable server |
| `REQUEST_FAILED` | An authenticated server request failed |

Messages are intended for logs and may change. Branch on `code`, and only retry
`CONFLICT` after reading fresh state. Omitting `expectedRevision` explicitly
chooses last-write-wins replacement against the latest server document.

## Shared editor modules

CodeMirror and Yjs extensions must continue to use `api.modules`. Bundling a
second copy can make extensions fail identity checks:

```js
const { state, view } = api.modules.codemirror;

api.editor.registerExtension([
  state.EditorState.tabSize.of(2),
  view.EditorView.lineWrapping,
]);
```

The complete source-level contract and method documentation live in
`frontend/src/plugin-api/index.ts`.
