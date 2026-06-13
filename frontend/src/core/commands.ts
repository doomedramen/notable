import { createStore } from "zustand";
import type { Command, Disposable } from "../plugin-api";
import { useUI } from "../store/ui";

/* Command registry. Lives outside React (vanilla store) so plugins can
   register commands before/without any component mounting; the palette
   subscribes for reactive updates. */

interface CommandState {
  commands: ReadonlyMap<string, Command>;
}

export const commandStore = createStore<CommandState>(() => ({
  commands: new Map(),
}));

export function registerCommand(cmd: Command): Disposable {
  commandStore.setState((s) => {
    if (s.commands.has(cmd.id)) {
      console.warn(`[commands] duplicate id "${cmd.id}" — replacing`);
    }
    const next = new Map(s.commands);
    next.set(cmd.id, cmd);
    return { commands: next };
  });
  return {
    dispose: () => {
      commandStore.setState((s) => {
        if (s.commands.get(cmd.id) !== cmd) return s; // already replaced
        const next = new Map(s.commands);
        next.delete(cmd.id);
        return { commands: next };
      });
    },
  };
}

/** Run a command by id. Returns false if missing or `when()` vetoed it. */
export function runCommand(id: string): boolean {
  const cmd = commandStore.getState().commands.get(id);
  if (!cmd || (cmd.when && !cmd.when())) return false;
  useUI.getState().recordRecentCommand(id);
  cmd.run();
  return true;
}

/** Commands currently available (respects `when` guards). */
export function availableCommands(): Command[] {
  return [...commandStore.getState().commands.values()].filter(
    (c) => !c.when || c.when(),
  );
}
