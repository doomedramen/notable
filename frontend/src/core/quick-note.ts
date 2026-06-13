const MAX_TITLE_LENGTH = 80;

export function quickNoteTitle(title: string, content: string): string {
  const firstContentLine =
    content
      .split("\n")
      .map((line) =>
        line
          .replace(/^\s{0,3}#{1,6}\s+/, "")
          .replace(/^\s*[-*+]\s+/, "")
          .trim(),
      )
      .find(Boolean) ?? "";
  const candidate = (title.trim() || firstContentLine || "Untitled")
    .replace(/[\\/:*?"<>|#%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return candidate.slice(0, MAX_TITLE_LENGTH) || "Untitled";
}
