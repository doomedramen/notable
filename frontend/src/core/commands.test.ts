import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  availableCommands,
  commandStore,
  registerCommand,
  runCommand,
} from "./commands";

describe("command registry", () => {
  beforeEach(() => {
    commandStore.setState({ commands: new Map() });
  });

  it("registers, runs, and disposes a command", () => {
    const run = vi.fn();
    const d = registerCommand({ id: "t.hello", name: "Hello", run });

    expect(runCommand("t.hello")).toBe(true);
    expect(run).toHaveBeenCalledOnce();

    d.dispose();
    expect(runCommand("t.hello")).toBe(false);
  });

  it("respects `when` guards", () => {
    let enabled = false;
    const run = vi.fn();
    registerCommand({ id: "t.guarded", name: "G", when: () => enabled, run });

    expect(runCommand("t.guarded")).toBe(false);
    expect(availableCommands()).toHaveLength(0);

    enabled = true;
    expect(runCommand("t.guarded")).toBe(true);
    expect(availableCommands()).toHaveLength(1);
  });

  it("replacing a duplicate id keeps the newer command after old dispose", () => {
    const first = registerCommand({ id: "t.dup", name: "A", run: vi.fn() });
    const newer = vi.fn();
    registerCommand({ id: "t.dup", name: "B", run: newer });

    // Disposing the replaced registration must not remove the newer one.
    first.dispose();
    expect(runCommand("t.dup")).toBe(true);
    expect(newer).toHaveBeenCalledOnce();
  });
});
