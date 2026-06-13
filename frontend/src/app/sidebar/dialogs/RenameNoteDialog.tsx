import { useEffect, useState, type FormEvent } from "react";
import { useNotesStore } from "@/store/notes-store";
import { openNote } from "@/core/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notice } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NoteMeta } from "@/store/notes";

export function RenameNoteDialog({
  note,
  onClose,
  activePath,
}: {
  note: NoteMeta | null;
  onClose: () => void;
  activePath: string | null;
}) {
  const rename = useNotesStore((s) => s.rename);
  const [name, setName] = useState("");

  useEffect(() => {
    if (note) setName(note.name);
  }, [note]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!note) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === note.name) {
      onClose();
      return;
    }
    const newPath = note.folder
      ? `${note.folder}/${trimmed}.md`
      : `${trimmed}.md`;
    const wasActive = note.path === activePath;
    onClose();
    try {
      const meta = await rename(note.path, newPath);
      if (wasActive) openNote(meta.path);
      notice(`Renamed to “${trimmed}”.`, {
        duration: 6000,
        action: {
          label: "Undo",
          run: async () => {
            const restored = await rename(newPath, note.path);
            if (wasActive) openNote(restored.path);
          },
        },
      });
    } catch {
      notice("Rename failed — is the name taken?", { variant: "danger" });
    }
  };

  return (
    <Dialog open={note !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showClose={false}>
        <DialogTitle>Rename note</DialogTitle>
        <form onSubmit={submit}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-4"
            autoFocus
            onFocus={(e) => e.target.select()}
            aria-label="New name"
          />
          <DialogFooter>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit">
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
