# Writing Notable plugins

Notable plugins are ES modules loaded at runtime from the server's plugins
directory (`--plugins-dir`, env `PLUGINS_DIR`, default `./plugins`; in the
Docker image `/data/plugins`).

## Trust model — read this first

A plugin runs in the app's origin with **full access** to the UI, the API,
and every note. There is no sandbox. This is the same stance as Obsidian:
the gate is filesystem access to your server. Only install code you trust
or wrote.

## Anatomy

```
plugins/
  my-plugin/              ← directory name MUST equal manifest "id"
    manifest.json
    main.js               ← ES module (the "entry" field, default main.js)
```

`manifest.json`:

```json
{
  "id": "my-plugin",
  "name": "My plugin",
  "version": "1.0.0",
  "description": "What it does",
  "entry": "main.js"
}
```

`main.js` default-exports the plugin object:

```js
export default {
  async onload(api) {
    api.commands.register({
      id: "my-plugin.hello",
      name: "Say hello",
      hotkey: "Mod-Shift-H",
      run: () => api.ui.notice("Hello from my plugin!"),
    });
  },
  async onunload() {
    // Optional. Everything registered through `api` is disposed
    // automatically when the plugin is disabled — use this only for
    // cleanup the API doesn't know about (external connections, etc.).
  },
};
```

Enable it in **Settings → Plugins** (Cmd/Ctrl-, ). Toggling applies live —
no reload needed.

## The API surface

See [`frontend/src/plugin-api/index.ts`](../frontend/src/plugin-api/index.ts)
for the full typed contract. Summary:

| Area | What you can do |
| --- | --- |
| `api.commands.register(cmd)` | Add commands (appear in the Cmd-K palette) |
| `api.hotkeys.register(key, commandId)` | Bind keys, e.g. `"Mod-Shift-X"` |
| `api.editor.registerExtension(ext)` | Add CodeMirror 6 extensions to every editor |
| `api.editor.activeView()` | The live `EditorView` (or null) |
| `api.workspace.registerSidebarPanel / registerRightPanel` | Add panels (mount-based, any framework) |
| `api.workspace.registerSettingsTab / registerStatusBarItem` | Settings pages, status bar widgets |
| `api.workspace.openNote(id)` / `toggleRightPanel(id)` | Navigation |
| `api.vault.list() / create() / activeNoteId()` | Note metadata |
| `api.events.on("note:open" \| "editor:ready" \| …)` | App lifecycle events |
| `api.settings.load() / save(data)` | Per-plugin persistent JSON settings |
| `api.ui.notice(msg)` / `api.ui.confirm(msg)` | Toasts and confirm dialogs |

Panels and status items use `mount(el) => cleanup` so you can use plain DOM,
React, or anything else.

## The one hard rule: share the host's modules

If your plugin touches CodeMirror or Yjs, you **must** use the instances the
host exposes at `api.modules` — a second bundled copy of `@codemirror/state`
breaks the editor silently.

```js
export default {
  onload(api) {
    const { view, state } = api.modules.codemirror; // host instances
    api.editor.registerExtension(
      view.EditorView.updateListener.of((u) => { /* … */ }),
    );
  },
};
```

If you build with a bundler, mark them external. esbuild example:

```sh
esbuild src/main.ts --bundle --format=esm --outfile=main.js \
  --external:@codemirror/* --external:yjs
```

…and import from `api.modules` at runtime rather than from the externals.
(Simplest reliable pattern: don't import CodeMirror at all; destructure
everything you need from `api.modules`.)

## Lifecycle and failure

- Enabled plugins load once at app startup (in parallel) and on toggle.
- A plugin that throws during load shows a toast and stays disabled-in-
  effect; it can never take the app down.
- On disable, `onunload()` runs, then every `Disposable` created through
  your `api` handle is disposed automatically (commands, panels, editor
  extensions, event listeners — all of it).

## Example

[`plugins/word-count`](../plugins/word-count) is a complete, commented
single-file plugin: status bar item + editor update listener.
