import { useEffect, useState } from "react";
import { Trash2, RotateCcw, X } from "lucide-react";
import {
  deleteFromTrash,
  listTrash,
  restoreFromTrash,
  type TrashedNote,
} from "../store/notes";
import { syncNotesList } from "../store/notes-store";
import { confirm } from "../components/ui/confirm";
import { notice } from "../components/ui/toast";
import { on } from "../core/events";

/** Lists notes sitting in `.trash/`, with restore / delete-forever (route: /trash). */
export function TrashView() {
  const [items, setItems] = useState<TrashedNote[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = async () => {
    setItems(await listTrash());
    setLoaded(true);
  };

  useEffect(() => {
    void refresh();
    const sub = on("note:delete", () => void refresh());
    return () => sub.dispose();
  }, []);

  const handleRestore = async (note: TrashedNote) => {
    setItems((prev) => prev.filter((n) => n.path !== note.path));
    await restoreFromTrash(note);
    await syncNotesList();
  };

  const handleDeleteForever = async (note: TrashedNote) => {
    if (!(await confirm(`Permanently delete “${note.name}”? This cannot be undone.`))) {
      return;
    }
    setItems((prev) => prev.filter((n) => n.path !== note.path));
    try {
      await deleteFromTrash(note.path);
    } catch {
      notice("Failed to delete.", { variant: "danger" });
      await refresh();
    }
  };

  return (
    <div className="mx-auto w-full max-w-[46rem] flex-1 overflow-y-auto px-4 pt-4 md:px-6 md:pt-8">
      <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight">
        <Trash2 size={22} className="text-faint" />
        Trash
      </h1>
      {loaded && items.length === 0 ? (
        <p className="mt-4 text-[13px] text-faint">Trash is empty.</p>
      ) : (
        <ul className="mt-4">
          {items.map((note) => (
            <li
              key={note.path}
              className="flex items-center gap-2 rounded-sm px-2 py-2 text-[13px] text-foreground hover:bg-surface-hover"
            >
              <span className="flex-1 truncate">
                {note.name}
                {note.original_path.includes("/") && (
                  <span className="ml-2 text-[11px] text-faint">
                    {note.original_path.slice(0, note.original_path.lastIndexOf("/"))}
                  </span>
                )}
              </span>
              <button
                onClick={() => void handleRestore(note)}
                className="rounded-sm p-1.5 text-muted hover:bg-surface-hover hover:text-foreground"
                aria-label={`Restore ${note.name}`}
                title="Restore"
              >
                <RotateCcw size={14} />
              </button>
              <button
                onClick={() => void handleDeleteForever(note)}
                className="rounded-sm p-1.5 text-muted hover:bg-surface-hover hover:text-danger"
                aria-label={`Delete ${note.name} forever`}
                title="Delete forever"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
