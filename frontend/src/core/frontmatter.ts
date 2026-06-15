import YAML from "yaml";
import type { DocumentSnapshot, DocumentWriteOptions } from "@/plugin-api";
import * as documents from "./documents";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface ParsedFrontmatter {
  /** Parsed YAML frontmatter, or `{}` when the note has none. */
  data: Record<string, unknown>;
  /** Note text after the frontmatter block. */
  body: string;
  /** Whether a `---` frontmatter block was present. */
  hasFrontmatter: boolean;
}

/** Split a note's text into its YAML frontmatter (if any) and body. */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const match = text.match(FRONTMATTER_PATTERN);
  if (!match) return { data: {}, body: text, hasFrontmatter: false };

  const parsed = YAML.parse(match[1]);
  const data =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return { data, body: text.slice(match[0].length), hasFrontmatter: true };
}

/**
 * Render `data` as a YAML frontmatter block followed by `body`. An empty
 * `data` object omits the frontmatter block entirely.
 */
export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  if (Object.keys(data).length === 0) return body;
  const yaml = YAML.stringify(data).trimEnd();
  return `---\n${yaml}\n---\n${body}`;
}

/** Read and parse a note's YAML frontmatter. */
export async function read(path: string): Promise<Record<string, unknown>> {
  const snapshot = await documents.read(path);
  return parseFrontmatter(snapshot.text).data;
}

/**
 * Replace a note's YAML frontmatter with `data`, preserving the body.
 * Pass `{}` to remove the frontmatter block.
 */
export async function write(
  path: string,
  data: Record<string, unknown>,
  options?: DocumentWriteOptions,
): Promise<DocumentSnapshot> {
  const snapshot = await documents.read(path);
  const { body } = parseFrontmatter(snapshot.text);
  const text = stringifyFrontmatter(data, body);
  return documents.replace(path, text, {
    expectedRevision: snapshot.revision,
    ...options,
  });
}
