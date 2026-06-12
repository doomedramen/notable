import { useEffect, useRef, useState } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { basicSetup } from "codemirror";
import { yCollab } from "y-codemirror.next";
import { NoteConnection } from "../sync/provider";

type Status = "offline" | "connecting" | "synced";

export function Editor({ noteId }: { noteId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("connecting");

  useEffect(() => {
    if (!host.current) return;

    const conn = new NoteConnection(noteId);
    conn.onStatus = setStatus;

    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        // yCollab binds the editor buffer to conn.text bidirectionally;
        // we never set doc content manually.
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          yCollab(conn.text, null),
        ],
      }),
    });

    return () => {
      view.destroy();
      conn.destroy();
    };
  }, [noteId]);

  return (
    <div className="editor">
      <div className={`sync-badge sync-${status}`}>
        {status === "synced" ? "Synced" : status === "connecting" ? "Connecting…" : "Offline — changes saved locally"}
      </div>
      <div ref={host} className="cm-host" />
    </div>
  );
}
