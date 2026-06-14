import { Fragment, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { Command as Cmdk } from "cmdk";
import fuzzysort from "fuzzysort";
import { commandStore, runCommand } from "@/core/commands";
import { openNote } from "@/core/navigation";
import { useNotesStore } from "@/store/notes-store";
import { useUI } from "@/store/ui";
import { normalizeKey } from "@/core/hotkeys";
import { Skeleton } from "@/components/ui/skeleton";
import { AppIcon } from "@/components/AppIcon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getIconAssignment,
  iconAssignmentStore,
} from "@/core/icon-assignments";

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

interface SearchHit {
  path: string;
  name: string;
  /** Body excerpt; … wrap matched terms (rendered as <mark>). */
  snippet: string;
}

/** Render a server snippet, turning the control-char markers into
    highlights without ever interpreting note content as HTML. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/[\u0001\u0002]/);
  return (
    <span className="truncate text-xs text-muted">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i % 2 === 1 ? (
            <mark className="rounded-xs bg-accent-soft px-0.5 text-accent">
              {part}
            </mark>
          ) : (
            part
          )}
        </Fragment>
      ))}
    </span>
  );
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPaletteOpen);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const notes = useNotesStore((s) => s.notes);
  const commands = useStore(commandStore, (s) => s.commands);
  const recentNotePaths = useUI((s) => s.recentNotePaths);
  const recentCommandIds = useUI((s) => s.recentCommandIds);
  useStore(iconAssignmentStore, (s) => s.assignments);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Debounced server-side full-text search. Offline (or any failure)
  // degrades to the local fuzzy title match below.
  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: ctrl.signal,
        });
        if (res.ok) setHits(await res.json());
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const visibleCommands = useMemo(
    () => [...commands.values()].filter((c) => !c.when || c.when()),
    [commands, open], // re-evaluate `when` guards each time it opens
  );

  // fuzzysort over titles/names; empty query shows recents/all commands.
  const noteResults = useMemo(() => {
    if (!query) {
      const byPath = new Map(notes.map((note) => [note.path, note]));
      const recent = recentNotePaths
        .map((path) => byPath.get(path))
        .filter((note): note is (typeof notes)[number] => note !== undefined);
      return [...recent, ...notes.filter((note) => !recentNotePaths.includes(note.path))]
        .slice(0, 8);
    }
    return fuzzysort
      .go(query, notes, { keys: ["name", "path"], limit: 8 })
      .map((r) => r.obj);
  }, [query, notes, recentNotePaths]);

  const commandResults = useMemo(() => {
    if (!query) {
      const order = new Map(recentCommandIds.map((id, index) => [id, index]));
      return [...visibleCommands].sort(
        (a, b) =>
          (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );
    }
    return fuzzysort
      .go(query, visibleCommands, { key: "name", limit: 10 })
      .map((r) => r.obj);
  }, [query, visibleCommands, recentCommandIds]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showClose={false}
        className="top-[8%] w-[calc(100vw-1.5rem)] max-w-lg translate-y-0 overflow-hidden p-0 md:top-[20%]"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search notes by title or content and run application commands.
        </DialogDescription>
        <Cmdk shouldFilter={false} label="Command palette">
          <Cmdk.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search notes and commands…"
            className="h-11 w-full border-b border-border bg-transparent px-4 text-sm text-foreground outline-none placeholder:text-faint"
          />
          <Cmdk.List className="max-h-[min(20rem,calc(100dvh-var(--keyboard-inset,0px)-7rem))] overflow-y-auto overscroll-contain p-1.5">
            <Cmdk.Empty className="px-3 py-8 text-center text-sm text-faint">
              No results.
            </Cmdk.Empty>

            {noteResults.length > 0 && (
              <Cmdk.Group
                heading={
                  query || recentNotePaths.length === 0 ? "Notes" : "Recent notes"
                }
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
                    className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm text-foreground select-none data-[selected=true]:bg-surface-hover"
                  >
                    <AppIcon
                      icon={
                        getIconAssignment({ kind: "note", path: note.path }) ??
                        "note"
                      }
                      fallback="note"
                      size={14}
                      className="shrink-0 text-faint"
                    />
                    <span className="truncate">{note.name}</span>
                    {note.folder && (
                      <span className="ml-auto truncate text-xs text-faint">
                        {note.folder.replaceAll("/", "  /  ")}
                      </span>
                    )}
                  </Cmdk.Item>
                ))}
              </Cmdk.Group>
            )}

            {searching && hits.length === 0 && (
              <div className="space-y-1.5 px-2 py-1.5">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-3/4" />
              </div>
            )}

            {hits.length > 0 && (
              <Cmdk.Group
                heading="Content"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint"
              >
                {hits.map((hit) => (
                  <Cmdk.Item
                    key={`s-${hit.path}`}
                    value={`search-${hit.path}`}
                    onSelect={() => {
                      setOpen(false);
                      openNote(hit.path);
                    }}
                    className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm text-foreground select-none data-[selected=true]:bg-surface-hover"
                  >
                    <AppIcon
                      icon="file-search"
                      size={14}
                      className="shrink-0 text-faint"
                    />
                    <span className="shrink-0">{hit.name}</span>
                    <Snippet text={hit.snippet} />
                  </Cmdk.Item>
                ))}
              </Cmdk.Group>
            )}

            {commandResults.length > 0 && (
              <Cmdk.Group
                heading={
                  query || recentCommandIds.length === 0
                    ? "Commands"
                    : "Recent commands"
                }
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
                    className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm text-foreground select-none data-[selected=true]:bg-surface-hover"
                  >
                    <AppIcon
                      icon={cmd.icon ?? "command"}
                      size={14}
                      className="shrink-0 text-faint"
                    />
                    <span className="flex-1 truncate">{cmd.name}</span>
                    {cmd.hotkey && (
                      <kbd className="rounded-sm border border-border bg-surface px-1.5 py-0.5 font-sans text-xs text-muted">
                        {prettyHotkey(cmd.hotkey)}
                      </kbd>
                    )}
                  </Cmdk.Item>
                ))}
              </Cmdk.Group>
            )}
          </Cmdk.List>
        </Cmdk>
      </DialogContent>
    </Dialog>
  );
}
