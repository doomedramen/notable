import * as Y from "yjs";

/**
 * Replace the contents of `ytext` with `newText`, given that its current
 * value is `oldText`. Trims the common prefix/suffix and applies a single
 * delete+insert for the differing middle region, inside a transaction with
 * no explicit origin — so the change is indistinguishable from a normal
 * local edit (sent over the wire when online, `markDirty`'d when offline).
 */
export function applyMarkdownDiff(ytext: Y.Text, oldText: string, newText: string): void {
  if (oldText === newText) return;

  let start = 0;
  const maxStart = Math.min(oldText.length, newText.length);
  while (start < maxStart && oldText[start] === newText[start]) start++;

  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const doc = ytext.doc;
  const apply = () => {
    if (oldEnd > start) ytext.delete(start, oldEnd - start);
    const insertion = newText.slice(start, newEnd);
    if (insertion) ytext.insert(start, insertion);
  };

  if (doc) {
    doc.transact(apply);
  } else {
    apply();
  }
}
