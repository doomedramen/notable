import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginAPI } from "./api";
import { commandStore } from "./commands";
import { workspaceStore } from "./workspace";
import { emit } from "./events";
import type { Disposable } from "../plugin-api";

/* The cleanup invariant: EVERYTHING a plugin registers through its API
   handle must be released by disposing the tracked disposables — this is
   what guarantees a disabled plugin leaves no trace even if its own
   onunload forgets things. */

describe("plugin API handle", () => {
  beforeEach(() => {
    commandStore.setState({ commands: new Map() });
    workspaceStore.setState({
      sidebarPanels: [],
      rightPanels: [],
      settingsTabs: [],
      statusBarItems: [],
      noteToolbarItems: [],
      noteContextMenuItems: [],
      folderContextMenuItems: [],
      noteDecorators: [],
      sidebarSortComparators: [],
      activeRightPanel: null,
    });
  });

  it("tracks every registration and disposes them all", () => {
    const disposables: Disposable[] = [];
    const api = createPluginAPI(
      { id: "test-plugin", name: "Test", version: "0.0.0" },
      disposables,
    );

    const onOpen = vi.fn();
    api.commands.register({ id: "tp.cmd", name: "Cmd", run: vi.fn() });
    api.hotkeys.register("Mod-9", "tp.cmd");
    const statusItem = api.workspace.registerStatusBarItem({
      id: "tp.s",
      text: "Ready",
    });
    statusItem.update({ text: "Updated" });
    api.workspace.registerRightPanel({
      id: "tp.p",
      title: "P",
      mount: () => () => {},
    });
    api.events.on("note:open", onOpen);

    expect(disposables).toHaveLength(5);
    expect(commandStore.getState().commands.has("tp.cmd")).toBe(true);
    expect(workspaceStore.getState().rightPanels).toHaveLength(1);
    expect(workspaceStore.getState().statusBarItems[0]).toMatchObject({
      text: "Updated",
    });

    // What the plugin loader does on unload:
    for (const d of disposables.splice(0)) d.dispose();

    expect(commandStore.getState().commands.has("tp.cmd")).toBe(false);
    expect(workspaceStore.getState().statusBarItems).toHaveLength(0);
    expect(workspaceStore.getState().rightPanels).toHaveLength(0);
    emit("note:open", "x.md");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("exposes the host's CodeMirror/Yjs module instances", async () => {
    const api = createPluginAPI(
      { id: "test-plugin", name: "Test", version: "0.0.0" },
      [],
    );
    const hostState = await import("@codemirror/state");
    const hostYjs = await import("yjs");
    // Identity, not just shape — a duplicate instance breaks the editor.
    expect(api.modules.codemirror.state).toBe(hostState);
    expect(api.modules.yjs).toBe(hostYjs);
  });

  it("builds versioned safe asset URLs", () => {
    const api = createPluginAPI(
      { id: "test-plugin", name: "Test", version: "1.2.3" },
      [],
    );
    expect(api.assets.url("assets/icon pack.json")).toBe(
      "/api/plugins/test-plugin/assets/icon%20pack.json?v=1.2.3",
    );
    expect(() => api.assets.url("../secret")).toThrow(/safe relative path/);
  });
});
