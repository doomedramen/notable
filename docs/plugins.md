# Notable plugins

Notable loads browser-side ES module plugins through a typed API. There are two
sources:

- **Core plugins** live in `core-plugins/`, ship with every Notable build, and
  cannot be uninstalled. A core manifest may set `defaultEnabled: true`.
- **Community plugins** are published by the separate
  [`notable-plugins`](https://github.com/doomedramen/notable-plugins) repository.
  Notable downloads a package from its registry, verifies its SHA-256 checksum,
  validates the manifest, and installs it into `PLUGINS_DIR`.

Both kinds can be enabled or disabled live in **Settings -> Plugins**.

## Trust model

A plugin runs in the app's origin with full access to the UI, API, and every
note. There is no browser sandbox. Package checksums protect download integrity;
they do not make untrusted code safe. Only install plugins you trust.

## Plugin anatomy

```text
my-plugin/
  manifest.json
  main.js
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

The directory name must equal `id`. IDs use lowercase letters, numbers, and
hyphens. Versions must be valid semantic versions. `entry` must be a relative
path inside the plugin package.

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
    // Optional cleanup for resources not registered through api.
  },
};
```

Everything registered through `api` is disposed automatically when the plugin
is disabled or updated.

## API surface

The complete typed contract is in
[`frontend/src/plugin-api/index.ts`](../frontend/src/plugin-api/index.ts).

| Area | What it can do |
| --- | --- |
| `api.commands` / `api.hotkeys` | Register commands and keyboard shortcuts |
| `api.editor` | Add CodeMirror extensions and access the active editor |
| `api.workspace` | Add panels, settings tabs, and status bar items |
| `api.vault` | List/create notes and inspect the active note |
| `api.events` | Subscribe to note, editor, and theme lifecycle events |
| `api.settings` | Store per-plugin JSON settings |
| `api.ui` | Show notices and confirmation dialogs |

## Share host modules

Plugins that use CodeMirror or Yjs must consume the instances exposed at
`api.modules`. Bundling a second `@codemirror/state` instance can break editor
extensions.

```js
export default {
  onload(api) {
    const { view } = api.modules.codemirror;
    api.editor.registerExtension(
      view.EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          // React to the edit.
        }
      }),
    );
  },
};
```

If a plugin has a build step, mark `@codemirror/*` and `yjs` as external and
read them from `api.modules` at runtime.

## Community registry

The default registry is the rolling `plugins-latest` release asset:

```text
https://github.com/doomedramen/notable-plugins/releases/download/plugins-latest/plugins.json
```

Operators can set `PLUGIN_REGISTRY_URL` to another HTTP(S) URL or a `file://`
URL for a private registry.

The registry format is:

```json
{
  "plugins": [
    {
      "id": "reading-time",
      "name": "Reading time",
      "version": "1.0.0",
      "description": "Shows an estimated reading time.",
      "author": "Notable community",
      "homepage": "https://github.com/doomedramen/notable-plugins",
      "package": {
        "url": "https://github.com/doomedramen/notable-plugins/releases/download/plugins-latest/reading-time.tar.gz",
        "sha256": "64 hexadecimal characters",
        "size": 1234
      }
    }
  ]
}
```

Packages are gzip-compressed tar archives containing `manifest.json`, the entry
module, and any assets. Installs reject path traversal, links, oversized
archives, checksum mismatches, and registry/manifest identity mismatches.

Community submissions belong in the separate plugin repository. Its CI builds
every plugin, creates deterministic packages, generates `plugins.json`, and
publishes all artifacts to the rolling GitHub release on every push to `main`.

## Core plugin development

Add core plugins directly under `core-plugins/<id>`. They are part of the
Notable release and should be reserved for features maintained with the app.
Core plugins currently include:

- `backlinks` - incoming links for the open note
- `live-preview` - rendered Markdown formatting while editing
- `outline` - heading navigation in a right panel
- `paste-url` - Markdown links when pasting URLs over selected text
- `recent-files` - recently opened note navigation
- `tags` - tag highlighting and navigation
- `wikilinks` - wiki link rendering, completion, and navigation
- `word-count` - live document and selection word counts

They are intentionally limited to features expected to benefit nearly every
Notable user. More specialized workflows belong in the community registry.
