# Notable plugin API v5

API v5 lets plugin feedback inherit Notable's responsive layout and interaction
behavior instead of requiring plugin-owned popovers or status UI.

## Actionable notices

The numeric duration form remains supported:

```ts
api.ui.notice("Index refreshed.", 3000);
```

Plugins can now provide structured options:

```ts
api.ui.notice("Moved note to Archive.", {
  duration: 6000,
  variant: "default",
  action: {
    label: "Undo",
    run: async () => {
      await api.vault.rename("Archive/Plan.md", "Plan.md");
    },
  },
});
```

`duration: 0` keeps a notice visible until dismissed. `variant` is `"default"`
or `"danger"`. The host renders and dismisses the action consistently on phone,
tablet, and desktop.

## Responsive status items

Prefer text status items for short plugin state:

```ts
const status = api.workspace.registerStatusBarItem({
  id: "sync-detail",
  text: "3 queued",
  tooltip: "Three plugin operations are waiting to sync.",
});

status.update({ text: "Synced" });
```

Notable keeps these items inline while space is available and moves them into a
host-owned overflow menu when the footer becomes crowded. Items may include an
icon and `onSelect`.

The legacy `mount(el)` status contribution remains supported, but arbitrary
mounted UI cannot be measured or represented inside the responsive menu.
