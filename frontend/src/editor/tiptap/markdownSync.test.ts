import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyMarkdownDiff } from "./markdownSync";

function setup(initial: string) {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  text.insert(0, initial);
  return { doc, text };
}

describe("applyMarkdownDiff", () => {
  it("is a no-op when the text is unchanged", () => {
    const { text } = setup("Hello world");
    applyMarkdownDiff(text, "Hello world", "Hello world");
    expect(text.toString()).toBe("Hello world");
  });

  it("handles an insertion at the end", () => {
    const { text } = setup("Hello");
    applyMarkdownDiff(text, "Hello", "Hello world");
    expect(text.toString()).toBe("Hello world");
  });

  it("handles an insertion in the middle", () => {
    const { text } = setup("Hello world");
    applyMarkdownDiff(text, "Hello world", "Hello, brave world");
    expect(text.toString()).toBe("Hello, brave world");
  });

  it("handles a deletion", () => {
    const { text } = setup("Hello, brave world");
    applyMarkdownDiff(text, "Hello, brave world", "Hello world");
    expect(text.toString()).toBe("Hello world");
  });

  it("handles a full replacement", () => {
    const { text } = setup("# Old heading\n\nOld body.");
    applyMarkdownDiff(text, "# Old heading\n\nOld body.", "# New heading\n\nNew body.");
    expect(text.toString()).toBe("# New heading\n\nNew body.");
  });

  it("handles emptying the text", () => {
    const { text } = setup("Hello");
    applyMarkdownDiff(text, "Hello", "");
    expect(text.toString()).toBe("");
  });

  it("handles filling previously empty text", () => {
    const { text } = setup("");
    applyMarkdownDiff(text, "", "Hello");
    expect(text.toString()).toBe("Hello");
  });
});
