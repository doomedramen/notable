import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { Command as Cmdk } from "cmdk";
import fuzzysort from "fuzzysort";
import { FileText, Terminal } from "lucide-react";
import { commandStore, runCommand } from "../core/commands";
import { openNote } from "../core/navigation";
import { useNotesStore } from "../store/notes-store";
import { useUI } from "../store/ui";
import { normalizeKey } from "../core/hotkeys";

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function prettyHotkey(hotkey: string): string {
  return normalizeKey(hotkey)
    .split("-")
    .map((part) => {
      switch (part) {
        case "meta":
          return "⌘";
        case "ctrl":
          return IS_MAC ? "⌃" : "Ctrl";
        case "alt":
          return IS_MAC ? "⌥" : "Alt";
        case "shift":
          return "⇧";
        default:
          return part.length === 1 ? part.toUpperCase() : part;
      }
    })
    .join(IS_MAC ? "" : "+");
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPaletteOpen);
  const [query, setQuery] = useState("");
  const notes = useNotesStore((s) => s.notes);
  const commands = useStore(commandStore, (s) => s.commands);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const visibleCommands = useMemo(
    () => [...commands.values()].filter((c) => !c.when || c.when()),
    [commands, open], // re-evaluate `when` guards each time it opens
  );

  // fuzzysort over titles/names; empty query shows recents/all commands.
  const noteResults = useMemo(() => {
    if (!query) return notes.slice(0, 8);
    return fuzzysort
      .go(query, notes, { keys: ["name", "path"], limit: 8 })
      .map((r) => r.obj);
  }, [query, notes]);

  const commandResults = useMemo(() => {
    if (!query) return visibleCommands;
    return fuzzysort
      .go(query, visibleCommands, { key: "name", limit: 10 })
      .map((r) => r.obj);
  }, [query, visibleCommands]);

  return (
    <Cmdk.Dialog
      open={open}
      onOpenChange={setOpen}
      shouldFilter={false}
      label="Command palette"
      className="ui-dialog fixed top-[20%] left-1/2 z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-md bg-background shadow-[var(--shadow-dialog)]"
    >
      <Cmdk.Input
        value={query}
        onValueChange={setQuery}
        placeholder="Search notes and commands…"
        className="h-11 w-full border-b border-border bg-transparent px-4 text-sm text-foreground outline-none placeholder:text-faint"
      />
      <Cmdk.List className="max-h-80 overflow-y-auto p-1.5">
        <Cmdk.Empty className="px-3 py-6 text-center text-[13px] text-faint">
          No results.
        </Cmdk.Empty>

        {noteResults.length > 0 && (
          <Cmdk.Group
            heading="Notes"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint"
          >
            {noteResults.map((note) => (
              <Cmdk.Item
                key={note.path}
                value={`note-${note.path}`}
                onSelect={() => {
                  setOpen(false);
                  openNote(note.path);
                }}
                className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-[13px] text-foreground select-none data-[selected=true]:bg-surface-hover"
              >
                <FileText size={14} className="shrink-0 text-faint" />
                <span className="truncate">{note.name}</span>
                {note.folder && (
                  <span className="ml-auto truncate text-[11px] text-faint">
                    {note.folder}
                  </span>
                )}
              </Cmdk.Item>
            ))}
          </Cmdk.Group>
        )}

        {commandResults.length > 0 && (
          <Cmdk.Group
            heading="Commands"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint"
          >
            {commandResults.map((cmd) => (
              <Cmdk.Item
                key={cmd.id}
                value={`cmd-${cmd.id}`}
                onSelect={() => {
                  setOpen(false);
                  runCommand(cmd.id);
                }}
                className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-[13px] text-foreground select-none data-[selected=true]:bg-surface-hover"
              >
                <Terminal size={14} className="shrink-0 text-faint" />
                <span className="flex-1 truncate">{cmd.name}</span>
                {cmd.hotkey && (
                  <kbd className="rounded-sm border border-border bg-surface px-1.5 py-0.5 font-sans text-[11px] text-muted">
                    {prettyHotkey(cmd.hotkey)}
                  </kbd>
                )}
              </Cmdk.Item>
            ))}
          </Cmdk.Group>
        )}
      </Cmdk.List>
    </Cmdk.Dialog>
  );
}
