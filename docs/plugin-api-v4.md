# Notable plugin API v4

API v4 adds frontmatter access, a font theme control, multi-selection
context-menu actions, a note toolbar contribution point, and sidebar
decoration/sorting hooks. Set `"apiVersion": 4` in the plugin manifest to
require these capabilities. Older API v1-v3 plugins remain compatible.

## Frontmatter

`api.frontmatter` reads and writes a note's YAML frontmatter block without
disturbing its body. Writes go through `api.documents`, so they are
Yjs/CRDT-safe like any other document edit.

```js
const meta = await api.frontmatter.read("Projects/Plan.md");
// meta is {} if the note has no frontmatter block

await api.frontmatter.write("Projects/Plan.md", {
  ...meta,
  status: "in-progress",
});
```

`write` replaces the entire frontmatter block with `data`. Pass `{}` to
remove the block. Like `api.documents.replace`, it accepts an optional
`expectedRevision` (it defaults to the revision just read, so concurrent
edits surface as `CONFLICT`).

## Font theme control

`ThemeControl` gains a `"font"` variant for theme settings that pick a
`font-family`:

```js
api.appearance.registerTheme({
  id: "reading",
  name: "Reading",
  stylesheet: "theme.css",
  controls: [
    {
      id: "body-font",
      label: "Body font",
      type: "font",
      cssVariable: "--font-body",
      default: "Inter, sans-serif",
      // Omit `options` to allow any font-family string.
      options: [
        { label: "Inter", value: "Inter, sans-serif" },
        { label: "Fira Code", value: "'Fira Code', monospace" },
      ],
    },
  ],
});
```

Values are restricted to characters valid in a `font-family` declaration
(letters, digits, spaces, commas, hyphens, underscores, and quotes).

## Multi-selection context menus

Sidebar notes can be multi-selected with `Cmd`/`Ctrl`-click (toggle) and
`Shift`-click (range). `when` and `run` on `ContextMenuItemSpec` now receive
the full selection:

```js
api.workspace.registerNoteContextMenu({
  id: "bulk-tag",
  label: "Tag as reviewed",
  when: (path, paths) => paths.every((p) => p.endsWith(".md")),
  run: async (path, paths) => {
    for (const p of paths) {
      const data = await api.frontmatter.read(p);
      await api.frontmatter.write(p, { ...data, reviewed: true });
    }
  },
});
```

`path` is the right-clicked note. `paths` is the full selection, including
`path`, or `[path]` when only one note is selected. Existing single-argument
handlers keep working unchanged.

## Note toolbar items

`api.workspace.registerNoteToolbarItem` adds a control next to the open
note's title:

```js
api.workspace.registerNoteToolbarItem({
  id: "word-count.toolbar",
  mount(el, path) {
    el.textContent = "...";
    update(el, path);
    return () => {};
  },
});
```

`mount(el, path)` is called once per opened note, like other mount-based
contribution points.

## Sidebar decorations and sorting

`api.workspace.registerNoteDecoration` annotates sidebar rows with a short
badge and/or a replacement icon:

```js
api.workspace.registerNoteDecoration((note) => {
  if (!note.path.startsWith("Tasks/")) return null;
  return { badge: "3" };
});
```

`api.workspace.registerSidebarSort` overrides note ordering within each
folder. The most recently registered comparator wins:

```js
api.workspace.registerSidebarSort((a, b) => b.modified - a.modified);
```

Both are disposed automatically when the plugin unloads, restoring the
default behavior.

The complete source-level contract lives in
`frontend/src/plugin-api/index.ts`.
