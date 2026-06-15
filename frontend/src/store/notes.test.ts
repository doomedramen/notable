import { describe, expect, it } from "vitest";
import {
  mergeServerListing,
  validateFolderPath,
  validateNotePath,
  type NoteMeta,
  type VaultListing,
} from "./notes";

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

function meta(path: string): NoteMeta {
  const slash = path.lastIndexOf("/");
  const file = slash === -1 ? path : path.slice(slash + 1);
  return {
    path,
    name: file.replace(/\.md$/i, ""),
    folder: slash === -1 ? "" : path.slice(0, slash),
    modified: 0,
  };
}

describe("mergeServerListing", () => {
  const server: VaultListing = {
    notes: [meta("A.md"), meta("B.md")],
    folders: [],
  };

  it("returns the server listing unchanged when the queue is empty", () => {
    const merged = mergeServerListing(server, { notes: [], folders: [] }, []);
    expect(merged.notes.map((n) => n.path)).toEqual(["A.md", "B.md"]);
  });

  it("re-adds an optimistic create the server has not seen yet", () => {
    const local: VaultListing = { notes: [meta("C.md")], folders: [] };
    const merged = mergeServerListing(server, local, [{ id: "1", kind: "create", path: "C.md" }]);
    expect(merged.notes.map((n) => n.path).sort()).toEqual(["A.md", "B.md", "C.md"]);
  });

  it("hides a note with a queued delete", () => {
    const merged = mergeServerListing(server, { notes: [meta("B.md")], folders: [] }, [
      { id: "1", kind: "delete", path: "A.md" },
    ]);
    expect(merged.notes.map((n) => n.path)).toEqual(["B.md"]);
  });

  it("does not resurrect a note trashed offline (rename into .trash/)", () => {
    // trashNote enqueues rename A.md -> .trash/A.md; the server still lists
    // A.md until the rename flushes.
    const local: VaultListing = { notes: [meta(".trash/A.md"), meta("B.md")], folders: [] };
    const merged = mergeServerListing(server, local, [
      { id: "1", kind: "rename", from: "A.md", to: ".trash/A.md" },
    ]);
    expect(merged.notes.map((n) => n.path)).toEqual(["B.md"]);
  });

  it("moves a note renamed offline to its new path", () => {
    const local: VaultListing = { notes: [meta("Renamed.md"), meta("B.md")], folders: [] };
    const merged = mergeServerListing(server, local, [
      { id: "1", kind: "rename", from: "A.md", to: "Renamed.md" },
    ]);
    expect(merged.notes.map((n) => n.path).sort()).toEqual(["B.md", "Renamed.md"]);
  });

  it("includes queued folders and a created note's parent folders", () => {
    const local: VaultListing = { notes: [meta("Work/Plan.md")], folders: [] };
    const merged = mergeServerListing(server, local, [
      { id: "1", kind: "mkdir", path: "Ideas" },
      { id: "2", kind: "create", path: "Work/Plan.md" },
    ]);
    expect(merged.folders).toEqual(["Ideas", "Work"]);
  });
});
