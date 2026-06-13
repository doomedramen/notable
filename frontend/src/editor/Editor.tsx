import { useEffect, useRef, useState } from "react";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  placeholder,
} from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import {
  defaultHighlightStyle,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { tags } from "@lezer/highlight";
import * as Y from "yjs";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { NoteConnection } from "@/sync/provider";
import { useSyncStatus } from "@/store/sync-status";
import {
  consumeEditorFocusRestore,
  editorExtensionStore,
  setActiveView,
} from "@/core/editor";
import { emit } from "@/core/events";
import { useNotesStore } from "@/store/notes-store";
import { openNote } from "@/core/navigation";
import { notice } from "@/components/ui/toast";
import { AppIcon } from "@/components/AppIcon";
import { MountHost } from "@/components/MountHost";
import { workspaceStore } from "@/core/workspace";
import {
  getIconAssignment,
  iconAssignmentStore,
} from "@/core/icon-assignments";
import { useStore } from "zustand";
import { takePendingContent } from "@/core/pending-content";
import { pluginDocumentChange } from "@/core/documents";

/* Typographic markdown styling — headings scale, syntax markers fade.
   (Full live preview that hides markers lands as a core plugin in a
   later phase; this keeps raw markdown pleasant in the meantime.) */
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.5em", fontWeight: "700" },
  { tag: tags.heading2, fontSize: "1.28em", fontWeight: "650" },
  { tag: tags.heading3, fontSize: "1.14em", fontWeight: "600" },
  { tag: tags.heading4, fontWeight: "600" },
  { tag: tags.heading5, fontWeight: "600" },
  { tag: tags.heading6, fontWeight: "600", color: "var(--muted)" },
  { tag: tags.strong, fontWeight: "650" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--accent)" },
  { tag: tags.url, color: "var(--faint)" },
  {
    tag: tags.monospace,
    fontFamily: "var(--font-mono)",
    fontSize: "0.88em",
  },
  { tag: tags.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: tags.processingInstruction, color: "var(--faint)" },
  { tag: tags.contentSeparator, color: "var(--faint)" },
]);

interface EditorMemory {
  anchor: number;
  head: number;
  scrollTop: number;
}

const editorMemory = new Map<string, EditorMemory>();

export function Editor({ notePath }: { notePath: string }) {
  const host = useRef<HTMLDivElement>(null);
  // Bumped when the connection discards local state (doc epoch change);
  // remounting rebuilds doc + view from the server's state.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!host.current) return;

    const conn = new NoteConnection(notePath);
    conn.onStatus = (s) => useSyncStatus.getState().setStatus(s);
    conn.onReset = () => setGeneration((g) => g + 1);

    // A note created via a shortcut/share-target arrives with content
    // staged for its first open (e.g. the OS share sheet's text/url).
    const pending = takePendingContent(notePath);
    if (pending && conn.text.length === 0) {
      conn.text.insert(0, pending);
    }

    // Yjs-aware undo: only local edits are undoable, remote ops survive.
    const undoManager = new Y.UndoManager(conn.text);

    // Plugin-contributed extensions live in a Compartment so enabling/
    // disabling a plugin reconfigures the live view without a remount.
    const pluginCompartment = new Compartment();
    const memory = editorMemory.get(notePath);
    const docLength = conn.text.length;
    const anchor = Math.min(memory?.anchor ?? 0, docLength);
    const head = Math.min(memory?.head ?? anchor, docLength);
    const shouldRestoreFocus = consumeEditorFocusRestore();

    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        // yCollab's ySync plugin only mirrors *future* ytext changes (it
        // observes from construction time), so any content already in
        // conn.text (e.g. share-target pending content) must seed the
        // initial doc here.
        doc: conn.text.toString(),
        selection: EditorSelection.single(anchor, head),
        // yCollab binds the editor buffer to conn.text bidirectionally;
        // we never set doc content manually beyond this initial seed.
        extensions: [
          highlightSpecialChars(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          markdown({ extensions: [GFM] }),
          syntaxHighlighting(markdownHighlight),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          placeholder("Start writing…"),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              useNotesStore.getState().touch(notePath);
              const source = update.transactions.some(
                (transaction) =>
                  transaction.annotation(pluginDocumentChange) === true,
              )
                ? "plugin"
                : "editor";
              emit("note:change", { path: notePath, source });
            }
            if (update.selectionSet) {
              const selection = update.state.selection.main;
              emit("editor:selection-change", {
                path: notePath,
                anchor: selection.anchor,
                head: selection.head,
                from: selection.from,
                to: selection.to,
              });
            }
          }),
          keymap.of([...yUndoManagerKeymap, ...defaultKeymap, indentWithTab]),
          yCollab(conn.text, null, { undoManager }),
          pluginCompartment.of([...editorExtensionStore.getState().extensions]),
        ],
      }),
    });
    let latestScrollTop = memory?.scrollTop ?? 0;
    const rememberScroll = () => {
      latestScrollTop = view.scrollDOM.scrollTop;
    };
    view.scrollDOM.addEventListener("scroll", rememberScroll, {
      passive: true,
    });
    if (memory || shouldRestoreFocus) {
      requestAnimationFrame(() => {
        if (shouldRestoreFocus) view.focus();
        if (memory) {
          requestAnimationFrame(() => {
            view.scrollDOM.scrollTop = memory.scrollTop;
            latestScrollTop = memory.scrollTop;
          });
        }
      });
    }

    const unsubscribe = editorExtensionStore.subscribe((s) => {
      view.dispatch({
        effects: pluginCompartment.reconfigure([...s.extensions]),
      });
    });

    setActiveView(view);
    emit("editor:ready", view);

    return () => {
      const selection = view.state.selection.main;
      editorMemory.set(notePath, {
        anchor: selection.anchor,
        head: selection.head,
        scrollTop: latestScrollTop,
      });
      view.scrollDOM.removeEventListener("scroll", rememberScroll);
      unsubscribe();
      emit("editor:destroy", view);
      setActiveView(null);
      view.destroy();
      conn.destroy();
      useSyncStatus.getState().setStatus(null);
    };
  }, [notePath, generation]);

  return (
    <div className="ui-view flex min-h-0 flex-1 flex-col">
      <div className="mx-auto w-full max-w-[var(--editor-measure)] shrink-0 px-4 pt-5 md:px-6 md:pt-9">
        <EditableTitle notePath={notePath} />
      </div>
      <div ref={host} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  );
}

/** Note title, doubling as a rename control — click to edit the filename. */
function EditableTitle({ notePath }: { notePath: string }) {
  const folder = notePath.includes("/")
    ? notePath.slice(0, notePath.lastIndexOf("/"))
    : "";
  const name = notePath.split("/").pop()!.replace(/\.md$/, "");
  const rename = useNotesStore((s) => s.rename);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  useStore(iconAssignmentStore, (state) => state.assignments);
  const icon = getIconAssignment({ kind: "note", path: notePath });

  useEffect(() => {
    setValue(name);
  }, [name]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = async () => {
    setEditing(false);
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) {
      setValue(name);
      return;
    }
    const newPath = folder ? `${folder}/${trimmed}.md` : `${trimmed}.md`;
    try {
      const meta = await rename(notePath, newPath);
      openNote(meta.path);
      notice(`Renamed to “${trimmed}”.`, {
        duration: 6000,
        action: {
          label: "Undo",
          run: async () => {
            const restored = await rename(newPath, notePath);
            openNote(restored.path);
          },
        },
      });
    } catch {
      setValue(name);
      notice("Rename failed — is the name taken?", { variant: "danger" });
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            setValue(name);
            setEditing(false);
          }
        }}
        className="w-full rounded-sm bg-transparent text-2xl font-semibold tracking-[-0.025em] outline-none ring-2 ring-accent"
        aria-label="Note title"
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      {icon && (
        <AppIcon
          icon={icon}
          fallback="note"
          size={22}
          className="text-faint"
        />
      )}
      <h1
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setEditing(true);
          }
        }}
        className="-mx-1 min-w-0 flex-1 cursor-text truncate rounded-sm px-1 text-2xl font-semibold tracking-[-0.025em] hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        title="Click to rename"
      >
        {name}
      </h1>
      <NoteToolbar notePath={notePath} />
    </div>
  );
}

/** Plugin-registered controls shown alongside the note title. */
function NoteToolbar({ notePath }: { notePath: string }) {
  const items = useStore(workspaceStore, (s) => s.noteToolbarItems);
  if (items.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {items.map((item) => (
        <MountHost
          key={item.id}
          mount={(el) => item.mount(el, notePath)}
          className="flex items-center"
        />
      ))}
    </div>
  );
}
