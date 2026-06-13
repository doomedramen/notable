import type {
  Backlink,
  OutgoingLink,
  SearchHit,
  SearchOptions,
  TagCount,
  TaggedNote,
} from "@/plugin-api";
import { encodePath } from "@/store/notes";
import {
  pluginAPIError,
  requestError,
  responseError,
} from "./plugin-api-error";

async function getJSON<T>(url: string, fallback: string): Promise<T> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw await responseError(response, fallback);
    return (await response.json()) as T;
  } catch (error) {
    throw requestError(error, fallback);
  }
}

export function query(
  text: string,
  options: SearchOptions = {},
): Promise<SearchHit[]> {
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 100)
  ) {
    throw pluginAPIError(
      "INVALID_ARGUMENT",
      "Search limit must be an integer between 1 and 100.",
    );
  }
  const params = new URLSearchParams({ q: text });
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  return getJSON(`/api/search?${params}`, "Could not search the vault.");
}

export async function backlinks(path: string): Promise<Backlink[]> {
  const rows = await getJSON<
    { source_path: string; source_name: string; context: string }[]
  >(`/api/backlinks/${encodePath(path)}`, `Could not load backlinks for "${path}".`);
  return rows.map((row) => ({
    sourcePath: row.source_path,
    sourceName: row.source_name,
    context: row.context,
  }));
}

export async function outgoingLinks(path: string): Promise<OutgoingLink[]> {
  const rows = await getJSON<{ target: string; path: string | null }[]>(
    `/api/links/${encodePath(path)}`,
    `Could not load outgoing links for "${path}".`,
  );
  return rows;
}

export function tags(): Promise<TagCount[]> {
  return getJSON("/api/tags", "Could not load tags.");
}

export function notesWithTag(tag: string): Promise<TaggedNote[]> {
  return getJSON(
    `/api/tags/${encodePath(tag)}`,
    `Could not load notes tagged "${tag}".`,
  );
}
