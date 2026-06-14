import { useMemo } from "react";
import type { NoteMeta } from "@/store/notes";

export interface FolderNode {
  path: string;
  name: string;
  notes: NoteMeta[];
  children: FolderNode[];
}

export function useFolderTree(notes: NoteMeta[], folders: string[], sortComparator?: (a: NoteMeta, b: NoteMeta) => number) {
  return useMemo(() => {
    const root: FolderNode = { path: "", name: "", notes: [], children: [] };
    const map = new Map<string, FolderNode>();
    map.set("", root);

    // Sort folders to process parents before children (though the loop below now handles missing parents)
    const sortedFolders = [...folders].sort((a, b) => a.localeCompare(b));

    const getOrCreateNode = (path: string): FolderNode => {
      let node = map.get(path);
      if (node) return node;

      const parts = path.split("/");
      const name = parts[parts.length - 1]!;
      const parentPath = parts.slice(0, -1).join("/");
      const parent = getOrCreateNode(parentPath);

      node = { path, name, notes: [], children: [] };
      map.set(path, node);
      parent.children.push(node);
      return node;
    };

    for (const path of sortedFolders) {
      if (!path) continue;
      getOrCreateNode(path);
    }

    for (const note of notes) {
      const node = map.get(note.folder);
      if (node) {
        node.notes.push(note);
      } else {
        // Fallback for notes in unlisted folders
        root.notes.push(note);
      }
    }

    // Apply sorting
    const sortNode = (node: FolderNode) => {
      if (sortComparator) {
        node.notes.sort(sortComparator);
      }
      node.children.sort((a, b) => a.name.localeCompare(b.name));
      for (const child of node.children) {
        sortNode(child);
      }
    };
    sortNode(root);

    return root;
  }, [notes, folders, sortComparator]);
}
