import { beforeEach, describe, expect, it } from "vitest";
import {
  registerRightPanel,
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
      noteContextMenuItems: [],
      folderContextMenuItems: [],
      activeRightPanel: null,
    });
  });

  it("registers and disposes status bar items", () => {
    const d = registerStatusBarItem({ id: "x", mount: noopMount });
    expect(workspaceStore.getState().statusBarItems).toHaveLength(1);
    d.dispose();
    expect(workspaceStore.getState().statusBarItems).toHaveLength(0);
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
