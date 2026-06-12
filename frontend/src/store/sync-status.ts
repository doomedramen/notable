import { create } from "zustand";

export type SyncStatus = "offline" | "connecting" | "synced";

interface SyncState {
  /** null = no note open, indicator hidden. */
  status: SyncStatus | null;
  /** Count of notes with local changes not yet on the server. */
  dirty: number;
  setStatus: (s: SyncStatus | null) => void;
  setDirty: (n: number) => void;
}

/** Written by the active editor's connection, read by the status bar. */
export const useSyncStatus = create<SyncState>((set) => ({
  status: null,
  dirty: 0,
  setStatus: (status) => set({ status }),
  setDirty: (dirty) => set({ dirty }),
}));
