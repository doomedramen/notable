import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { openNote } from "@/core/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";

interface TaggedNote {
  path: string;
  name: string;
}

/** Lists every note carrying a given `#tag` (route: /tag/*). */
export function TagView() {
  const params = useParams();
  const tag = params["*"] ?? "";
  const [notes, setNotes] = useState<TaggedNote[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!tag) return;
    setNotes([]);
    setLoaded(false);
    const ctrl = new AbortController();
    fetch(`/api/tags/${tag.split("/").map(encodeURIComponent).join("/")}`, {
      signal: ctrl.signal,
    })
      .then((res) => (res.ok ? res.json() : []))
      .then(setNotes)
      .catch(() => {
        if (!ctrl.signal.aborted) setNotes([]);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoaded(true);
      });
    return () => ctrl.abort();
  }, [tag]);

  return (
    <PageContainer>
      <PageHeader icon="tag">{tag}</PageHeader>
      {!loaded ? (
        <div className="mt-4 space-y-2 px-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-4/5" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : notes.length === 0 ? (
        <EmptyState icon="tag" className="mt-4">
          No notes tagged #{tag}.
        </EmptyState>
      ) : (
        <ul className="mt-4">
          {notes.map((note) => (
            <li key={note.path}>
              <button
                onClick={() => openNote(note.path)}
                className="w-full rounded-sm px-2 py-2 text-left text-sm text-foreground hover:bg-surface-hover"
              >
                {note.name}
                {note.path.includes("/") && (
                  <span className="ml-2 text-xs text-faint">
                    {note.path.slice(0, note.path.lastIndexOf("/"))}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
