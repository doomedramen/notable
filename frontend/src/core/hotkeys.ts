import type { Disposable } from "@/plugin-api";
import { commandStore, runCommand } from "./commands";

/* One global keydown listener resolves key chords against:
   1. explicit bindings made via hotkeys.register(key, commandId), then
   2. default hotkeys declared on commands themselves.
   Key syntax follows CodeMirror: "Mod-Shift-P" (Mod = Cmd on macOS,
   Ctrl elsewhere). */

const explicit = new Map<string, string>(); // normalized key -> command id

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Normalize "Mod-Shift-K" / "Ctrl-k" etc. to a canonical form. */
export function normalizeKey(key: string): string {
  const parts = key.split("-");
  const k = parts[parts.length - 1]!.toLowerCase();
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  // "Mod" resolves to the platform's primary modifier.
  if (mods.delete("mod")) mods.add(IS_MAC ? "meta" : "ctrl");
  if (mods.delete("cmd")) mods.add("meta");
  if (mods.delete("control")) mods.add("ctrl");
  return [...["ctrl", "alt", "shift", "meta"].filter((m) => mods.has(m)), k].join("-");
}

export function eventToKey(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("ctrl");
  if (e.altKey) mods.push("alt");
  if (e.shiftKey) mods.push("shift");
  if (e.metaKey) mods.push("meta");
  return [...mods, e.key.toLowerCase()].join("-");
}

export function registerHotkey(key: string, commandId: string): Disposable {
  const norm = normalizeKey(key);
  explicit.set(norm, commandId);
  return {
    dispose: () => {
      if (explicit.get(norm) === commandId) explicit.delete(norm);
    },
  };
}

/** Resolve a pressed key to a command id (exported for tests). */
export function resolveKey(pressed: string): string | null {
  const fromExplicit = explicit.get(pressed);
  if (fromExplicit) return fromExplicit;
  for (const cmd of commandStore.getState().commands.values()) {
    if (cmd.hotkey && normalizeKey(cmd.hotkey) === pressed) return cmd.id;
  }
  return null;
}

function onKeydown(e: KeyboardEvent): void {
  // Hotkeys always carry a modifier; never swallow plain typing.
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return;
  const id = resolveKey(eventToKey(e));
  if (id && runCommand(id)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

let installed = false;
export function installHotkeys(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("keydown", onKeydown, { capture: true });
}
