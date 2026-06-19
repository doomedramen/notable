import { create } from "zustand";

export type SyncStatus = "offline" | "connecting" | "synced";

interface SyncState {
  /** null = no note open. */
  status: SyncStatus | null;
  /** Count of notes with local changes not yet on the server. */
  dirty: number;
  /** Timestamp (ms) of the most recent successful sync. */
  lastSynced: number | null;
  setStatus: (s: SyncStatus | null) => void;
  setDirty: (n: number) => void;
  setLastSynced: (ts: number) => void;
}

/** Written by the active editor's connection, read by the status bar. */
export const useSyncStatus = create<SyncState>((set) => ({
  status: null,
  dirty: 0,
  lastSynced: null,
  setStatus: (status) => set({ status }),
  setDirty: (dirty) => set({ dirty }),
  setLastSynced: (lastSynced) => set({ lastSynced }),
}));
