import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingContent,
  peekPendingContent,
  setPendingContent,
  takePendingContent,
} from "./pending-content";

describe("pending note content", () => {
  afterEach(async () => clearPendingContent("Offline.md"));

  it("persists until the editor consumes it exactly once", async () => {
    await setPendingContent("Offline.md", "draft");

    expect(await peekPendingContent("Offline.md")).toBe("draft");
    expect(await takePendingContent("Offline.md")).toBe("draft");
    expect(await takePendingContent("Offline.md")).toBeNull();
  });
});
