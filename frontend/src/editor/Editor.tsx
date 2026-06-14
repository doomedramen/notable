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
import { languages } from "@codemirror/language-data";
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
    tag: [tags.monospace],
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

    let connection: NoteConnection | null = null;
    let view: EditorView | null = null;
    let unsubscribe: (() => void) | null = null;
    let rememberScroll: (() => void) | null = null;
    let latestScrollTop = 0;
    let cancelled = false;

    void (async () => {
      connection = new NoteConnection(
        notePath,
        takePendingContent(notePath),
      );
      connection.onStatus = (status) =>
        useSyncStatus.getState().setStatus(status);
      connection.onReset = () => setGeneration((value) => value + 1);
      await connection.ready;
      if (cancelled || !host.current) {
        connection.destroy();
        connection = null;
        return;
      }

      const undoManager = new Y.UndoManager(connection.text);
      const pluginCompartment = new Compartment();
      const memory = editorMemory.get(notePath);
      const docLength = connection.text.length;
      const anchor = Math.min(memory?.anchor ?? 0, docLength);
      const head = Math.min(memory?.head ?? anchor, docLength);
      const shouldRestoreFocus = consumeEditorFocusRestore();

      view = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: connection.text.toString(),
          selection: EditorSelection.single(anchor, head),
          extensions: [
            highlightSpecialChars(),
            drawSelection(),
            dropCursor(),
            indentOnInput(),
            markdown({ extensions: [GFM], codeLanguages: languages }),
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
            yCollab(connection.text, null, { undoManager }),
            pluginCompartment.of([
              ...editorExtensionStore.getState().extensions,
            ]),
          ],
        }),
      });
      latestScrollTop = memory?.scrollTop ?? 0;
      rememberScroll = () => {
        latestScrollTop = view?.scrollDOM.scrollTop ?? latestScrollTop;
      };
      view.scrollDOM.addEventListener("scroll", rememberScroll, {
        passive: true,
      });
      if (memory || shouldRestoreFocus) {
        requestAnimationFrame(() => {
          if (!view) return;
          if (shouldRestoreFocus) view.focus();
          if (memory) {
            requestAnimationFrame(() => {
              if (!view) return;
              view.scrollDOM.scrollTop = memory.scrollTop;
              latestScrollTop = memory.scrollTop;
            });
          }
        });
      }

      unsubscribe = editorExtensionStore.subscribe((state) => {
        view?.dispatch({
          effects: pluginCompartment.reconfigure([...state.extensions]),
        });
      });

      setActiveView(view);
      emit("editor:ready", view);
    })();

    return () => {
      cancelled = true;
      if (view) {
        const selection = view.state.selection.main;
        editorMemory.set(notePath, {
          anchor: selection.anchor,
          head: selection.head,
          scrollTop: latestScrollTop,
        });
        if (rememberScroll) {
          view.scrollDOM.removeEventListener("scroll", rememberScroll);
        }
        emit("editor:destroy", view);
        view.destroy();
      }
      unsubscribe?.();
      setActiveView(null);
      connection?.destroy();
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
