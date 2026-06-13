import { describe, expect, it } from "vitest";
import { validateFolderPath, validateNotePath } from "./notes";

describe("vault path validation", () => {
  it("accepts canonical vault paths", () => {
    expect(() => validateNotePath("Projects/Plan.md")).not.toThrow();
    expect(() => validateFolderPath("Projects/Archive")).not.toThrow();
  });

  it("rejects traversal, hidden paths, and non-Markdown notes", () => {
    expect(() => validateNotePath("../Plan.md")).toThrow();
    expect(() => validateNotePath(".private/Plan.md")).toThrow();
    expect(() => validateNotePath("Plan.txt")).toThrow();
    expect(() => validateFolderPath("Projects\\Archive")).toThrow();
  });
});
