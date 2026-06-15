import { useEffect, useState } from "react";
import { deleteFromTrash, listTrash, restoreFromTrash, type TrashedNote } from "@/store/notes";
import { syncNotesList } from "@/store/notes-store";
import { useNotesStore } from "@/store/notes-store";
import { confirm } from "@/components/ui/confirm";
import { notice } from "@/components/ui/toast";
import { on } from "@/core/events";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { AppIcon } from "@/components/AppIcon";
import { Skeleton } from "@/components/ui/skeleton";

/** Lists notes sitting in `.trash/`, with restore / delete-forever (route: /trash). */
export function TrashView() {
  const trash = useNotesStore((state) => state.trash);
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
    notice(`Restored “${note.name}”.`, {
      duration: 6000,
      action: {
        label: "Undo",
        run: async () => {
          await trash(note.original_path);
          await refresh();
        },
      },
    });
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
    <PageContainer>
      <PageHeader icon="trash">Trash</PageHeader>
      {!loaded ? (
        <div className="mt-4 space-y-2 px-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-4/5" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon="trash" className="mt-4">
          Trash is empty.
        </EmptyState>
      ) : (
        <ul className="mt-4">
          {items.map((note) => (
            <li
              key={note.path}
              className="flex items-center gap-2 rounded-sm px-2 py-2 text-sm text-foreground hover:bg-surface-hover"
            >
              <span className="flex-1 truncate">
                {note.name}
                {note.original_path.includes("/") && (
                  <span className="ml-2 text-xs text-faint">
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
                <AppIcon icon="restore" size={14} />
              </button>
              <button
                onClick={() => void handleDeleteForever(note)}
                className="rounded-sm p-1.5 text-muted hover:bg-surface-hover hover:text-danger"
                aria-label={`Delete ${note.name} forever`}
                title="Delete forever"
              >
                <AppIcon icon="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
