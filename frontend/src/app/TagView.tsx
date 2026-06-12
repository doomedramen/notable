import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Hash } from "lucide-react";
import { openNote } from "../core/navigation";

interface TaggedNote {
  path: string;
  name: string;
}

/** Lists every note carrying a given `#tag` (route: /tag/*). */
export function TagView() {
  const params = useParams();
  const tag = params["*"] ?? "";
  const [notes, setNotes] = useState<TaggedNote[]>([]);

  useEffect(() => {
    if (!tag) return;
    setNotes([]);
    const ctrl = new AbortController();
    fetch(`/api/tags/${tag.split("/").map(encodeURIComponent).join("/")}`, {
      signal: ctrl.signal,
    })
      .then((res) => (res.ok ? res.json() : []))
      .then(setNotes)
      .catch(() => {});
    return () => ctrl.abort();
  }, [tag]);

  return (
    <div className="mx-auto w-full max-w-[46rem] flex-1 overflow-y-auto px-4 pt-4 md:px-6 md:pt-8">
      <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight">
        <Hash size={22} className="text-faint" />
        {tag}
      </h1>
      {notes.length === 0 ? (
        <p className="mt-4 text-[13px] text-faint">No notes tagged #{tag}.</p>
      ) : (
        <ul className="mt-4">
          {notes.map((note) => (
            <li key={note.path}>
              <button
                onClick={() => openNote(note.path)}
                className="w-full rounded-sm px-2 py-2 text-left text-[13px] text-foreground hover:bg-surface-hover"
              >
                {note.name}
                {note.path.includes("/") && (
                  <span className="ml-2 text-[11px] text-faint">
                    {note.path.slice(0, note.path.lastIndexOf("/"))}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
