import type { AppEvents, Disposable } from "../plugin-api";

/* Tiny typed event bus. Framework-agnostic — plugins and core both use it. */

type AnyHandler = (...args: never[]) => void;

const handlers = new Map<keyof AppEvents, Set<AnyHandler>>();

export function on<K extends keyof AppEvents>(
  event: K,
  fn: AppEvents[K],
): Disposable {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(fn as AnyHandler);
  return {
    dispose: () => {
      set.delete(fn as AnyHandler);
    },
  };
}

export function emit<K extends keyof AppEvents>(
  event: K,
  ...args: Parameters<AppEvents[K]>
): void {
  const set = handlers.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      (fn as unknown as (...a: Parameters<AppEvents[K]>) => void)(...args);
    } catch (err) {
      // A broken listener (e.g. from a plugin) must not break the rest.
      console.error(`[events] handler for "${event}" threw`, err);
    }
  }
}
