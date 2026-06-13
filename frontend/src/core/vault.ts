import type {
  CreateNoteOptions,
  NoteMeta,
  VaultListing,
} from "@/plugin-api";
import { useNotesStore } from "@/store/notes-store";
import {
  validateFolderPath,
  validateNotePath,
} from "@/store/notes";
import { activeNoteId } from "./navigation";
import { pluginAPIError, requestError } from "./plugin-api-error";

/*
 * Typed facade over the offline-first metadata layer for plugins.
 *
 * All mutations go through the same Zustand/IndexedDB queue used by Notable's
 * own UI. Plugins must use this facade instead of raw `/api/notes` requests so
 * sidebar state, lifecycle events, icons, and offline replay stay coherent.
 */

async function state() {
  const current = useNotesStore.getState();
  if (!current.loaded) await current.refresh();
  return useNotesStore.getState();
}

function assertNotePath(path: string): void {
  try {
    validateNotePath(path);
  } catch (error) {
    throw pluginAPIError(
      "INVALID_ARGUMENT",
      error instanceof Error ? error.message : "Invalid note path.",
    );
  }
}

function assertFolderPath(path: string): void {
  try {
    validateFolderPath(path);
  } catch (error) {
    throw pluginAPIError(
      "INVALID_ARGUMENT",
      error instanceof Error ? error.message : "Invalid folder path.",
    );
  }
}

export async function list(): Promise<NoteMeta[]> {
  return [...(await state()).notes];
}

export async function listFolders(): Promise<string[]> {
  return [...(await state()).folders];
}

export async function refresh(): Promise<VaultListing> {
  await useNotesStore.getState().refresh();
  const current = useNotesStore.getState();
  return { notes: [...current.notes], folders: [...current.folders] };
}

export async function stat(path: string): Promise<NoteMeta | null> {
  assertNotePath(path);
  return (await state()).notes.find((note) => note.path === path) ?? null;
}

export async function exists(path: string): Promise<boolean> {
  return (await stat(path)) !== null;
}

export async function create(
  optionsOrName: CreateNoteOptions | string = {},
  legacyFolder = "",
): Promise<NoteMeta> {
  const options =
    typeof optionsOrName === "string"
      ? { name: optionsOrName, folder: legacyFolder }
      : optionsOrName;
  try {
    if (options.path) assertNotePath(options.path);
    if (options.folder) assertFolderPath(options.folder);
    return await useNotesStore
      .getState()
      .create(
        options.name ?? "Untitled",
        options.folder ?? "",
        options.content ?? "",
        options.path,
      );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create note.";
    if (message.includes("already exists")) {
      throw pluginAPIError("CONFLICT", message);
    }
    if (message.startsWith("Invalid") || message.includes("must contain")) {
      throw pluginAPIError("INVALID_ARGUMENT", message);
    }
    throw requestError(error, "Could not create note.");
  }
}

export async function rename(from: string, to: string): Promise<NoteMeta> {
  try {
    assertNotePath(from);
    assertNotePath(to);
    return await useNotesStore.getState().rename(from, to);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Could not rename "${from}".`;
    if (message.startsWith("Invalid") || message.includes("must end in .md")) {
      throw pluginAPIError("INVALID_ARGUMENT", message);
    }
    if (message.includes("already exists")) {
      throw pluginAPIError("CONFLICT", message);
    }
    throw requestError(error, `Could not rename "${from}".`);
  }
}

export async function trash(path: string): Promise<void> {
  try {
    assertNotePath(path);
    await useNotesStore.getState().trash(path);
  } catch (error) {
    throw requestError(error, `Could not trash "${path}".`);
  }
}

export async function remove(path: string): Promise<void> {
  try {
    assertNotePath(path);
    await useNotesStore.getState().remove(path);
  } catch (error) {
    throw requestError(error, `Could not delete "${path}".`);
  }
}

export async function createFolder(path: string): Promise<void> {
  try {
    assertFolderPath(path);
    await useNotesStore.getState().mkdir(path);
  } catch (error) {
    throw requestError(error, `Could not create folder "${path}".`);
  }
}

export async function renameFolder(from: string, to: string): Promise<void> {
  try {
    assertFolderPath(from);
    assertFolderPath(to);
    await useNotesStore.getState().renameFolder(from, to);
  } catch (error) {
    throw requestError(error, `Could not rename folder "${from}".`);
  }
}

export async function deleteFolder(path: string): Promise<void> {
  try {
    assertFolderPath(path);
    await useNotesStore.getState().rmdir(path);
  } catch (error) {
    if (error instanceof Error && error.message === "not-empty") {
      throw pluginAPIError("CONFLICT", `Folder "${path}" is not empty.`, 409);
    }
    throw requestError(error, `Could not delete folder "${path}".`);
  }
}

export { activeNoteId };
