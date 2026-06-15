import { lazy, Suspense } from "react";
import { useParams } from "react-router";
import { Editor } from "@/editor/Editor";
import { useUI } from "@/store/ui";

const TiptapEditor = lazy(() =>
  import("@/editor/tiptap/TiptapEditor").then((m) => ({ default: m.TiptapEditor })),
);

export function EditorPane() {
  // Splat param: the vault-relative path ("Projects/Plan.md").
  const params = useParams();
  const path = params["*"];
  const mode = useUI((s) => s.editorMode);
  if (!path) return null;
  // Keyed by path (and mode): switching notes or modes tears down the
  // previous connection + view cleanly.
  if (mode === "rich") {
    return (
      <Suspense fallback={null}>
        <TiptapEditor key={`rich:${path}`} notePath={path} />
      </Suspense>
    );
  }
  return <Editor key={`source:${path}`} notePath={path} />;
}
