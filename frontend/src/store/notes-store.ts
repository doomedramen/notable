import { create } from "zustand";
import {
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  flushQueue,
  listVault,
  renameNote,
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
  rename: (from: string, to: string) => Promise<NoteMeta>;
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
  },
  rename: async (from, to) => {
    const meta = await renameNote(from, to);
    set({ notes: get().notes.map((n) => (n.path === from ? meta : n)) });
    return meta;
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
