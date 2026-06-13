import { useParams } from "react-router";
import { Editor } from "@/editor/Editor";

export function EditorPane() {
  // Splat param: the vault-relative path ("Projects/Plan.md").
  const params = useParams();
  const path = params["*"];
  if (!path) return null;
  // Keyed by path: switching notes tears down the connection + view cleanly.
  return <Editor key={path} notePath={path} />;
}
