import { describe, expect, it } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";

describe("frontmatter", () => {
  it("parses a frontmatter block and body", () => {
    const text = "---\ntitle: Hello\ntags:\n  - a\n  - b\n---\n# Hello\n\nBody text\n";
    const { data, body, hasFrontmatter } = parseFrontmatter(text);
    expect(hasFrontmatter).toBe(true);
    expect(data).toEqual({ title: "Hello", tags: ["a", "b"] });
    expect(body).toBe("# Hello\n\nBody text\n");
  });

  it("reports no frontmatter for plain notes", () => {
    const text = "# Hello\n\nBody text\n";
    const { data, body, hasFrontmatter } = parseFrontmatter(text);
    expect(hasFrontmatter).toBe(false);
    expect(data).toEqual({});
    expect(body).toBe(text);
  });

  it("treats a non-mapping frontmatter document as empty data", () => {
    const text = "---\n- a\n- b\n---\nBody\n";
    const { data, hasFrontmatter } = parseFrontmatter(text);
    expect(hasFrontmatter).toBe(true);
    expect(data).toEqual({});
  });

  it("stringifies frontmatter back onto the body", () => {
    const text = stringifyFrontmatter({ title: "Hello", tags: ["a", "b"] }, "Body\n");
    expect(text).toBe("---\ntitle: Hello\ntags:\n  - a\n  - b\n---\nBody\n");
  });

  it("omits the frontmatter block for empty data", () => {
    expect(stringifyFrontmatter({}, "Body\n")).toBe("Body\n");
  });

  it("round-trips through parse and stringify", () => {
    const original = "---\ntitle: Hello\n---\nBody\n";
    const { data, body } = parseFrontmatter(original);
    expect(stringifyFrontmatter(data, body)).toBe(original);
  });
});
