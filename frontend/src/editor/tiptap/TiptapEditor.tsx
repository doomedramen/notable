import { useEffect, useRef, useState } from "react";
import { Editor, EditorContent } from "@tiptap/react";
import type { MarkdownStorage } from "tiptap-markdown";
import { NoteConnection } from "@/sync/provider";
import { useSyncStatus } from "@/store/sync-status";
import { emit } from "@/core/events";
import { useNotesStore } from "@/store/notes-store";
import { takePendingContent } from "@/core/pending-content";
import { parseFrontmatter, stringifyFrontmatter } from "@/core/frontmatter";
import { EditableTitle } from "@/editor/EditorHeader";
import { applyMarkdownDiff } from "./markdownSync";
import { createExtensions } from "./extensions";
import { BubbleToolbar } from "./BubbleToolbar";

const SYNC_DEBOUNCE_MS = 200;

export function TiptapEditor({ notePath }: { notePath: string }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  // Bumped when the connection discards local state (doc epoch change);
  // remounting rebuilds the doc + editor from the server's state.
  const [generation, setGeneration] = useState(0);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    let connection: NoteConnection | null = null;
    let cancelled = false;
    let frontmatter: Record<string, unknown> = {};
    let lastMarkdown = "";
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const syncFromYjs = (force: boolean) => {
      const current = editorRef.current;
      if (!connection || !current) return;
      const text = connection.text.toString();
      if (text === lastMarkdown) return;
      if (!force && current.isFocused) return;
      const parsed = parseFrontmatter(text);
      frontmatter = parsed.data;
      lastMarkdown = text;
      current.commands.setContent(parsed.body, { emitUpdate: false });
    };

    void (async () => {
      connection = new NoteConnection(notePath, takePendingContent(notePath));
      connection.onStatus = (status) => {
        useSyncStatus.getState().setStatus(status);
        if (status === "synced") useSyncStatus.getState().setLastSynced(Date.now());
      };
      connection.onReset = () => setGeneration((value) => value + 1);
      await connection.ready;
      if (cancelled || !connection) {
        connection?.destroy();
        return;
      }

      const initial = connection.text.toString();
      const parsed = parseFrontmatter(initial);
      frontmatter = parsed.data;
      lastMarkdown = initial;

      const instance = new Editor({
        extensions: createExtensions(),
        content: parsed.body,
        onUpdate: () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            if (!connection) return;
            const markdownStorage = (instance.storage as unknown as Record<string, unknown>)
              .markdown as MarkdownStorage;
            const body = markdownStorage.getMarkdown();
            const full = stringifyFrontmatter(frontmatter, body);
            const previous = lastMarkdown;
            if (full === previous) return;
            lastMarkdown = full;
            applyMarkdownDiff(connection.text, previous, full);
            useNotesStore.getState().touch(notePath);
            emit("note:change", { path: notePath, source: "editor" });
          }, SYNC_DEBOUNCE_MS);
        },
        onBlur: () => syncFromYjs(true),
      });

      connection.text.observe(() => syncFromYjs(false));

      editorRef.current = instance;
      setEditor(instance);
    })();

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      editorRef.current?.destroy();
      editorRef.current = null;
      setEditor(null);
      connection?.destroy();
      useSyncStatus.getState().setStatus(null);
    };
  }, [notePath, generation]);

  return (
    <div className="ui-view flex min-h-0 flex-1 flex-col">
      <div className="mx-auto w-full max-w-[var(--editor-measure)] shrink-0 px-4 pt-5 md:px-6 md:pt-9">
        <EditableTitle notePath={notePath} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {editor && (
          <>
            <BubbleToolbar editor={editor} />
            <EditorContent
              editor={editor}
              className="mx-auto w-full max-w-[var(--editor-measure)] px-4 pb-24 md:px-6"
            />
          </>
        )}
      </div>
    </div>
  );
}

export default TiptapEditor;
