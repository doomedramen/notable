import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { useNotesStore } from "../store/notes-store";
import { encodePath } from "../store/notes";

/** Target of the installed app's "New note" shortcut: creates a note and
    redirects straight into it. */
export function NewNote() {
  const [target, setTarget] = useState<string | null>(null);
  const create = useNotesStore((s) => s.create);

  useEffect(() => {
    void create().then((meta) => setTarget(`/note/${encodePath(meta.path)}`));
  }, [create]);

  if (target) return <Navigate to={target} replace />;
  return null;
}
