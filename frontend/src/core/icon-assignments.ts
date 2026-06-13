import { createStore } from "zustand";
import type { IconRef, IconTarget } from "@/plugin-api";

interface IconAssignment extends IconTarget {
  icon: IconRef;
}

interface AssignmentMutation extends IconTarget {
  icon: IconRef | null;
}

interface AssignmentState {
  assignments: ReadonlyMap<string, IconRef>;
  loaded: boolean;
}

export const iconAssignmentStore = createStore<AssignmentState>(() => ({
  assignments: new Map(),
  loaded: false,
}));

const DB_NAME = "notable-icons";
const STORE_NAME = "kv";
const CACHE_KEY = "assignments";
const QUEUE_KEY = "queue";

export async function loadIconAssignments(): Promise<void> {
  try {
    const response = await fetch("/api/icon-assignments");
    if (!response.ok) throw new Error();
    const assignments = (await response.json()) as IconAssignment[];
    await setCached(assignments);
    iconAssignmentStore.setState({
      assignments: assignmentMap(assignments),
      loaded: true,
    });
  } catch {
    const cached = (await getCached<IconAssignment[]>(CACHE_KEY)) ?? [];
    iconAssignmentStore.setState({
      assignments: assignmentMap(cached),
      loaded: true,
    });
  }
}

export function getIconAssignment(target: IconTarget): IconRef | null {
  return iconAssignmentStore.getState().assignments.get(key(target)) ?? null;
}

export async function setIconAssignment(
  target: IconTarget,
  icon: IconRef | null,
): Promise<void> {
  updateLocal(target, icon);
  const mutation = { ...target, icon };
  try {
    await sendMutation(mutation);
  } catch {
    const queue = (await getCached<AssignmentMutation[]>(QUEUE_KEY)) ?? [];
    await putCached(QUEUE_KEY, [...queue, mutation]);
  }
}

export async function flushIconAssignmentQueue(): Promise<void> {
  const queue = (await getCached<AssignmentMutation[]>(QUEUE_KEY)) ?? [];
  if (queue.length === 0) return;
  const remaining: AssignmentMutation[] = [];
  for (const mutation of queue) {
    try {
      await sendMutation(mutation);
    } catch {
      remaining.push(mutation);
    }
  }
  await putCached(QUEUE_KEY, remaining);
}

export function moveCachedIconAssignment(
  kind: IconTarget["kind"],
  from: string,
  to: string,
): void {
  const icon = getIconAssignment({ kind, path: from });
  if (!icon) return;
  const assignments = new Map(iconAssignmentStore.getState().assignments);
  assignments.delete(key({ kind, path: from }));
  assignments.set(key({ kind, path: to }), icon);
  iconAssignmentStore.setState({ assignments });
  void persistMap(assignments);
}

export function removeCachedIconAssignment(
  kind: IconTarget["kind"],
  path: string,
): void {
  const assignments = new Map(iconAssignmentStore.getState().assignments);
  if (!assignments.delete(key({ kind, path }))) return;
  iconAssignmentStore.setState({ assignments });
  void persistMap(assignments);
}

export function removeCachedFolderTree(path: string): void {
  const assignments = new Map(iconAssignmentStore.getState().assignments);
  let changed = false;
  for (const assignmentKey of assignments.keys()) {
    if (
      assignmentKey === `folder:${path}` ||
      assignmentKey.startsWith(`folder:${path}/`)
    ) {
      assignments.delete(assignmentKey);
      changed = true;
    }
  }
  if (!changed) return;
  iconAssignmentStore.setState({ assignments });
  void persistMap(assignments);
}

function updateLocal(target: IconTarget, icon: IconRef | null): void {
  const assignments = new Map(iconAssignmentStore.getState().assignments);
  if (icon) assignments.set(key(target), icon);
  else assignments.delete(key(target));
  iconAssignmentStore.setState({ assignments });
  void persistMap(assignments);
}

async function sendMutation(mutation: AssignmentMutation): Promise<void> {
  const response = await fetch("/api/icon-assignments", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mutation),
  });
  if (!response.ok) throw new Error("could not update icon assignment");
}

function key(target: IconTarget): string {
  return `${target.kind}:${target.path}`;
}

function assignmentMap(
  assignments: readonly IconAssignment[],
): ReadonlyMap<string, IconRef> {
  return new Map(assignments.map((assignment) => [key(assignment), assignment.icon]));
}

async function setCached(assignments: IconAssignment[]): Promise<void> {
  await putCached(CACHE_KEY, assignments);
}

async function persistMap(assignments: ReadonlyMap<string, IconRef>): Promise<void> {
  await putCached(
    CACHE_KEY,
    [...assignments].map(([assignmentKey, icon]) => {
      const separator = assignmentKey.indexOf(":");
      return {
        kind: assignmentKey.slice(0, separator),
        path: assignmentKey.slice(separator + 1),
        icon,
      };
    }),
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCached<T>(cacheKey: string): Promise<T | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME)
      .objectStore(STORE_NAME)
      .get(cacheKey);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function putCached(cacheKey: string, value: unknown): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME, "readwrite")
      .objectStore(STORE_NAME)
      .put(value, cacheKey);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
