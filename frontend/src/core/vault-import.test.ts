import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  MAX_NOTE_BYTES,
  previewDirectoryFiles,
  previewZip,
  resolvePreviewConflicts,
} from "./vault-import";

function folderFile(path: string, body: BlobPart): File {
  const file = new File([body], path.split("/").pop()!);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("vault import parsing", () => {
  it("preserves a selected folder and normalizes Markdown extensions", async () => {
    const preview = await previewDirectoryFiles([
      folderFile("My Notes/Plan.MD", "# Plan"),
      folderFile("My Notes/Nested/Idea.md", "idea"),
      folderFile("My Notes/image.png", "not a note"),
      folderFile("My Notes/.hidden.md", "secret"),
    ]);

    expect(preview.rootName).toBe("My Notes");
    expect(preview.entries.map((entry) => entry.path)).toEqual([
      "My Notes/Plan.md",
      "My Notes/Nested/Idea.md",
    ]);
    expect(preview.folders).toContain("My Notes/Nested");
    expect(preview.skipped.map((item) => item.reason)).toEqual([
      "not-markdown",
      "hidden",
    ]);
  });

  it("rejects invalid UTF-8 and notes over the per-file limit", async () => {
    const preview = await previewDirectoryFiles([
      folderFile("Import/Broken.md", new Uint8Array([0xc3, 0x28])),
      folderFile("Import/Huge.md", new Uint8Array(MAX_NOTE_BYTES + 1)),
    ]);

    expect(preview.entries).toHaveLength(0);
    expect(preview.skipped.map((item) => item.reason)).toEqual([
      "invalid-utf8",
      "note-too-large",
    ]);
  });

  it("preserves a shared ZIP root and empty folders", async () => {
    const archive = zipSync({
      "Vault/Plan.md": new TextEncoder().encode("plan"),
      "Vault/Empty/": new Uint8Array(),
    });
    const preview = await previewZip(new File([archive], "backup.zip"));

    expect(preview.rootName).toBe("Vault");
    expect(preview.entries[0]?.path).toBe("Vault/Plan.md");
    expect(preview.folders).toContain("Vault/Empty");
  });

  it("wraps root-level ZIP entries and rejects traversal", async () => {
    const archive = zipSync({
      "Plan.md": new TextEncoder().encode("plan"),
      "../Escape.md": new TextEncoder().encode("nope"),
    });
    const preview = await previewZip(new File([archive], "My Backup.zip"));

    expect(preview.entries[0]?.path).toBe("My Backup/Plan.md");
    expect(preview.skipped).toContainEqual({
      path: "../Escape.md",
      reason: "invalid-path",
    });
  });

  it("auto-renames conflicts against the vault and the batch", () => {
    const preview = resolvePreviewConflicts(
      {
        rootName: "Import",
        entries: [
          { path: "Import/Plan.md", content: "one", size: 3 },
          { path: "Import/Plan.md", content: "two", size: 3 },
        ],
        folders: ["Import"],
        skipped: [],
        conflicts: [],
        totalBytes: 6,
      },
      ["Import/Plan.md"],
    );

    expect(preview.entries.map((entry) => entry.path)).toEqual([
      "Import/Plan 1.md",
      "Import/Plan 2.md",
    ]);
    expect(preview.conflicts).toHaveLength(2);
  });
});
