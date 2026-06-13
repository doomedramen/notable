# Notable plugin API v6

API v6 adds a host-rendered modal dialog, so plugins can present forms or
other focused UI without building their own overlay.

## Modal dialogs

```ts
const modal = api.ui.openModal({
  title: "Quick Note",
  mount(el) {
    el.textContent = "Hello from a plugin!";
    return () => {
      // cleanup when the modal closes
    };
  },
});

// Close it programmatically:
modal.dispose();
```

`mount(el)` receives an empty container element inside the dialog and must
return a cleanup function, following the same convention as
`registerSidebarPanel`/`registerRightPanel`/`registerSettingsTab`. The host
shows one modal at a time; opening a new one closes any modal already open.
The cleanup function runs both when the plugin calls `dispose()` and when the
user dismisses the dialog (Escape, backdrop click, or a control inside
`mount` that calls `dispose()`).

`className` is an optional extra class applied to the dialog's content
element, for sizing or layout tweaks.
