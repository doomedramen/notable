import { describe, expect, it } from "vitest";
import { quickNoteTitle } from "./quick-note";

describe("quickNoteTitle", () => {
  it("prefers an explicit title", () => {
    expect(quickNoteTitle("A title", "First line")).toBe("A title");
  });

  it("derives and sanitizes a title from the first content line", () => {
    expect(quickNoteTitle("", "# Project: launch")).toBe("Project launch");
  });

  it("falls back to Untitled", () => {
    expect(quickNoteTitle("", " \n ")).toBe("Untitled");
  });
});
