import type { NoteMeta } from "../plugin-api";
import { useNotesStore } from "../store/notes-store";
import { emit } from "./events";
import { activeNoteId } from "./navigation";

/* Typed facade over the offline-first metadata layer for plugins. */

export async function list(): Promise<NoteMeta[]> {
  const state = useNotesStore.getState();
  if (!state.loaded) await state.refresh();
  return useNotesStore.getState().notes;
}

export async function create(name = "Untitled", folder = ""): Promise<NoteMeta> {
  const meta = await useNotesStore.getState().create(name, folder);
  emit("note:create", meta);
  return meta;
}

export { activeNoteId };
