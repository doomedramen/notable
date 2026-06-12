import { describe, expect, it, vi } from "vitest";
import { emit, on } from "./events";

describe("event bus", () => {
  it("delivers events until disposed", () => {
    const fn = vi.fn();
    const d = on("note:open", fn);

    emit("note:open", "A.md");
    expect(fn).toHaveBeenCalledWith("A.md");

    d.dispose();
    emit("note:open", "B.md");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("a throwing listener does not break the others", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = on("note:delete", () => {
      throw new Error("boom");
    });
    const fn = vi.fn();
    const ok = on("note:delete", fn);

    emit("note:delete", "X.md");
    expect(fn).toHaveBeenCalledWith("X.md");

    boom.dispose();
    ok.dispose();
    errSpy.mockRestore();
  });
});
