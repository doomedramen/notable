import { beforeEach, describe, expect, it } from "vitest";
import {
  registerNoteDecoration,
  registerRightPanel,
  registerSidebarSort,
  registerStatusBarItem,
  toggleRightPanel,
  workspaceStore,
} from "./workspace";

const noopMount = () => () => {};

describe("workspace registries", () => {
  beforeEach(() => {
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

  it("registers and disposes status bar items", () => {
    const d = registerStatusBarItem({ id: "x", mount: noopMount });
    expect(workspaceStore.getState().statusBarItems).toHaveLength(1);
    d.dispose();
    expect(workspaceStore.getState().statusBarItems).toHaveLength(0);
  });

  it("registers and disposes note decorations", () => {
    const decorate = () => ({ badge: "3" });
    const d = registerNoteDecoration(decorate);
    expect(workspaceStore.getState().noteDecorators).toHaveLength(1);
    expect(workspaceStore.getState().noteDecorators[0]?.({
      path: "a.md",
      name: "a",
      folder: "",
      modified: 0,
    })).toEqual({ badge: "3" });
    d.dispose();
    expect(workspaceStore.getState().noteDecorators).toHaveLength(0);
  });

  it("registers and disposes sidebar sort comparators", () => {
    const compare = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name);
    const d = registerSidebarSort(compare);
    expect(workspaceStore.getState().sidebarSortComparators).toHaveLength(1);
    d.dispose();
    expect(workspaceStore.getState().sidebarSortComparators).toHaveLength(0);
  });

  it("toggles right panels and clears the active one on dispose", () => {
    const d = registerRightPanel({ id: "p", title: "P", mount: noopMount });

    toggleRightPanel("p");
    expect(workspaceStore.getState().activeRightPanel).toBe("p");
    toggleRightPanel("p");
    expect(workspaceStore.getState().activeRightPanel).toBeNull();

    toggleRightPanel("p");
    d.dispose();
    // Disposing a visible panel must hide it, or the shell would render
    // a ghost host for a mount function that no longer exists.
    expect(workspaceStore.getState().activeRightPanel).toBeNull();
    expect(workspaceStore.getState().rightPanels).toHaveLength(0);
  });
});
