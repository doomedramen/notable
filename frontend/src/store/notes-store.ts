import { create } from "zustand";
import { emit } from "../core/events";
import {
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  flushQueue,
  listVault,
  renameNote,
  trashNote,
  type NoteMeta,
} from "./notes";

/* Reactive wrapper around the offline-first metadata layer (store/notes.ts)
   so the sidebar, command palette, and plugins share one vault listing. */

interface NotesState {
  notes: NoteMeta[];
  folders: string[];
  loaded: boolean;
  refresh: () => Promise<void>;
  create: (name?: string, folder?: string) => Promise<NoteMeta>;
  remove: (path: string) => Promise<void>;
  trash: (path: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<NoteMeta>;
  renameFolder: (from: string, to: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  rmdir: (path: string) => Promise<void>;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  folders: [],
  loaded: false,
  refresh: async () => {
    const { notes, folders } = await listVault();
    set({ notes, folders, loaded: true });
  },
  create: async (name = "Untitled", folder = "") => {
    const meta = await createNote(name, folder);
    set({ notes: [meta, ...get().notes] });
    return meta;
  },
  remove: async (path) => {
    set({ notes: get().notes.filter((n) => n.path !== path) });
    await deleteNote(path);
    emit("note:delete", path);
  },
  trash: async (path) => {
    set({ notes: get().notes.filter((n) => n.path !== path) });
    await trashNote(path);
    emit("note:delete", path);
  },
  rename: async (from, to) => {
    const meta = await renameNote(from, to);
    set({ notes: get().notes.map((n) => (n.path === from ? meta : n)) });
    return meta;
  },
  renameFolder: async (from, to) => {
    const { notes, folders } = get();
    // Move every note inside the folder (incl. nested subfolders) by
    // swapping the path prefix. Reusing the note rename means files, the
    // search index, live sync rooms and icon assignments all move with it,
    // and it goes through the offline queue like any other rename.
    for (const n of notes.filter(
      (n) => n.folder === from || n.folder.startsWith(`${from}/`),
    )) {
      await get().rename(n.path, `${to}${n.path.slice(from.length)}`);
    }
    // Recreate the folder and any empty subfolders under the new name.
    for (const f of folders.filter(
      (f) => f === from || f.startsWith(`${from}/`),
    )) {
      await get().mkdir(`${to}${f.slice(from.length)}`);
    }
    // Drop the old, now-empty tree. Best-effort: offline this throws (there
    // is no queued folder delete), so just prune it from local state and
    // leave the empty directory for the next sync to reconcile.
    try {
      await get().rmdir(from);
    } catch {
      set({
        folders: get().folders.filter(
          (f) => f !== from && !f.startsWith(`${from}/`),
        ),
      });
    }
  },
  mkdir: async (path) => {
    await createFolder(path);
    const folders = get().folders;
    if (!folders.includes(path)) {
      set({ folders: [...folders, path].sort() });
    }
  },
  rmdir: async (path) => {
    await deleteFolder(path);
    set({
      folders: get().folders.filter(
        (f) => f !== path && !f.startsWith(`${path}/`),
      ),
    });
  },
}));

/** Replay offline mutations and reload. Call on startup and `online`. */
export async function syncNotesList(): Promise<void> {
  await flushQueue();
  await useNotesStore.getState().refresh();
}
