import { useEffect, useState } from "react";
import { Editor } from "./editor/Editor";
import { InstallPrompt } from "./InstallPrompt";
import { listNotes, createNote, deleteNote, flushQueue, NoteMeta } from "./store/notes";
import { dirtyCount, DIRTY_EVENT } from "./sync/dirty";

export default function App() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [unsynced, setUnsynced] = useState(dirtyCount());

  const refresh = () => listNotes().then(setNotes);

  useEffect(() => {
    flushQueue().then(refresh);
    const onOnline = () => flushQueue().then(refresh);
    const onDirty = (e: Event) => setUnsynced((e as CustomEvent<number>).detail);
    window.addEventListener("online", onOnline);
    window.addEventListener(DIRTY_EVENT, onDirty);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener(DIRTY_EVENT, onDirty);
    };
  }, []);

  const handleCreate = async () => {
    const title = prompt("Note title?") || "Untitled";
    const meta = await createNote(title);
    setNotes((n) => [meta, ...n]);
    setActiveId(meta.id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this note?")) return;
    await deleteNote(id);
    if (activeId === id) setActiveId(null);
    refresh();
  };

  return (
    <div className="app">
      <InstallPrompt />
      {unsynced > 0 && (
        <div className="unsynced-banner" role="status">
          {unsynced} note{unsynced > 1 ? "s have" : " has"} changes not yet on
          the server — they're saved on this device and will sync when you're
          back online.
        </div>
      )}
      <div className="layout">
        <aside className="sidebar">
          <button className="new-note" onClick={handleCreate}>+ New note</button>
          <ul>
            {notes.map((n) => (
              <li key={n.id} className={n.id === activeId ? "active" : ""}>
                <button className="note-title" onClick={() => setActiveId(n.id)}>{n.title}</button>
                <button className="note-delete" onClick={() => handleDelete(n.id)} aria-label="Delete note">×</button>
              </li>
            ))}
          </ul>
        </aside>
        <main>
          {activeId
            ? <Editor key={activeId} noteId={activeId} />
            : <div className="empty">Select a note or create one to start writing.</div>}
        </main>
      </div>
    </div>
  );
}
