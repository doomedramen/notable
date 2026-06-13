import { useEffect, useRef } from "react";
import { useNotesStore } from "@/store/notes-store";
import { openNote } from "@/core/navigation";

/** Target of the installed app's "New note" shortcut: creates a note and
    redirects straight into it. */
export function NewNote() {
  const create = useNotesStore((s) => s.create);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void create("Untitled", "", "").then((meta) => openNote(meta.path));
  }, [create]);

  return null;
}
