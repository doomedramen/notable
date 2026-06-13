import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { useNotesStore } from "@/store/notes-store";
import { encodePath } from "@/store/notes";
import { setPendingContent } from "@/core/pending-content";

const MAX_TITLE_LENGTH = 80;

/** Sanitize shared text into a usable filename stem. */
function titleFrom(title: string, text: string, url: string): string {
  const candidate = (title || text.split("\n")[0] || url || "Untitled")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return candidate.slice(0, MAX_TITLE_LENGTH) || "Untitled";
}

function contentFrom(title: string, text: string, url: string): string {
  const parts: string[] = [];
  if (title) parts.push(`# ${title}`);
  if (text) parts.push(text);
  if (url) parts.push(url);
  return parts.join("\n\n");
}

/** Target of the OS share sheet (manifest share_target): creates a note
    from the shared title/text/url and opens it. */
export function ShareTarget() {
  const [target, setTarget] = useState<string | null>(null);
  const create = useNotesStore((s) => s.create);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const title = params.get("title") ?? "";
    const text = params.get("text") ?? "";
    const url = params.get("url") ?? "";
    const content = contentFrom(title, text, url);

    void create(titleFrom(title, text, url)).then((meta) => {
      if (content) setPendingContent(meta.path, content);
      setTarget(`/note/${encodePath(meta.path)}`);
    });
  }, [create]);

  if (target) return <Navigate to={target} replace />;
  return null;
}
