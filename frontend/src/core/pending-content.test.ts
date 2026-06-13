import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingContent,
  peekPendingContent,
  setPendingContent,
  takePendingContent,
} from "./pending-content";

describe("pending note content", () => {
  afterEach(() => clearPendingContent("Offline.md"));

  it("persists until the editor consumes it exactly once", () => {
    setPendingContent("Offline.md", "draft");

    expect(peekPendingContent("Offline.md")).toBe("draft");
    expect(takePendingContent("Offline.md")).toBe("draft");
    expect(takePendingContent("Offline.md")).toBeNull();
  });
});
