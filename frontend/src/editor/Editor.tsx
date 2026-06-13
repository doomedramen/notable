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
import { Compartment, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { tags } from "@lezer/highlight";
import * as Y from "yjs";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { NoteConnection } from "../sync/provider";
import { useSyncStatus } from "../store/sync-status";
import { editorExtensionStore, setActiveView } from "../core/editor";
import { emit } from "../core/events";
import { useNotesStore } from "../store/notes-store";
import { openNote } from "../core/navigation";
import { notice } from "../components/ui/toast";
import { takePendingContent } from "../core/pending-content";

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

    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        // yCollab's ySync plugin only mirrors *future* ytext changes (it
        // observes from construction time), so any content already in
        // conn.text (e.g. share-target pending content) must seed the
        // initial doc here.
        doc: conn.text.toString(),
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
          keymap.of([...yUndoManagerKeymap, ...defaultKeymap, indentWithTab]),
          yCollab(conn.text, null, { undoManager }),
          pluginCompartment.of([...editorExtensionStore.getState().extensions]),
        ],
      }),
    });

    const unsubscribe = editorExtensionStore.subscribe((s) => {
      view.dispatch({
        effects: pluginCompartment.reconfigure([...s.extensions]),
      });
    });

    setActiveView(view);
    emit("editor:ready", view);

    return () => {
      unsubscribe();
      setActiveView(null);
      view.destroy();
      conn.destroy();
      useSyncStatus.getState().setStatus(null);
    };
  }, [notePath, generation]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto w-full max-w-[46rem] shrink-0 px-4 pt-4 md:px-6 md:pt-8">
        <EditableTitle notePath={notePath} />
      </div>
      <div ref={host} className="min-h-0 flex-1 overflow-auto" />
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
        className="w-full rounded-sm bg-transparent text-2xl font-bold tracking-tight outline-none ring-2 ring-accent"
        aria-label="Note title"
      />
    );
  }

  return (
    <h1
      onClick={() => setEditing(true)}
      className="-mx-1 cursor-text rounded-sm px-1 text-2xl font-bold tracking-tight hover:bg-surface-hover"
      title="Click to rename"
    >
      {name}
    </h1>
  );
}
