import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandStore, registerCommand } from "./commands";
import { eventToKey, normalizeKey, registerHotkey, resolveKey } from "./hotkeys";

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "meta" : "ctrl";

describe("hotkeys", () => {
  beforeEach(() => {
    commandStore.setState({ commands: new Map() });
  });

  it("normalizes Mod to the platform modifier, in canonical order", () => {
    expect(normalizeKey("Mod-k")).toBe(`${MOD}-k`);
    expect(normalizeKey("Shift-Mod-P")).toBe(IS_MAC ? "shift-meta-p" : "ctrl-shift-p");
    expect(normalizeKey("Alt-,")).toBe("alt-,");
  });

  it("converts keyboard events to the same canonical form", () => {
    const e = new KeyboardEvent("keydown", { key: "K", metaKey: IS_MAC, ctrlKey: !IS_MAC });
    expect(eventToKey(e)).toBe(normalizeKey("Mod-k"));
  });

  it("resolves explicit bindings before command defaults, and disposes", () => {
    registerCommand({ id: "t.a", name: "A", hotkey: "Mod-e", run: vi.fn() });
    const explicit = registerHotkey("Mod-e", "t.b");

    expect(resolveKey(normalizeKey("Mod-e"))).toBe("t.b");
    explicit.dispose();
    expect(resolveKey(normalizeKey("Mod-e"))).toBe("t.a");
  });

  it("returns null for unbound keys", () => {
    expect(resolveKey(normalizeKey("Mod-Shift-F12"))).toBeNull();
  });
});
