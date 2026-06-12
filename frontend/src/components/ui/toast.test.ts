import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notice, toastStore } from "./toast";

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toastStore.setState({ toasts: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a toast and auto-dismisses it after its duration", () => {
    notice("saved", { duration: 1000 });
    expect(toastStore.getState().toasts).toHaveLength(1);
    expect(toastStore.getState().toasts[0]!.message).toBe("saved");

    vi.advanceTimersByTime(1001);
    expect(toastStore.getState().toasts).toHaveLength(0);
  });

  it("keeps persistent toasts (duration 0) until dismissed manually", () => {
    notice("stay", { duration: 0 });
    vi.advanceTimersByTime(60_000);
    const { toasts, dismiss } = toastStore.getState();
    expect(toasts).toHaveLength(1);

    dismiss(toasts[0]!.id);
    expect(toastStore.getState().toasts).toHaveLength(0);
  });

  it("stacks multiple toasts independently", () => {
    notice("one", { duration: 1000 });
    notice("two", { duration: 5000 });
    expect(toastStore.getState().toasts).toHaveLength(2);

    vi.advanceTimersByTime(1001);
    expect(toastStore.getState().toasts.map((t) => t.message)).toEqual(["two"]);
  });
});
