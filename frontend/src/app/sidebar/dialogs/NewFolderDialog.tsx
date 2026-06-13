import { useEffect, useState, type FormEvent } from "react";
import { useNotesStore } from "../../../store/notes-store";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { notice } from "../../../components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../../../components/ui/dialog";

export function NewFolderDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const mkdir = useNotesStore((s) => s.mkdir);
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmed) return;
    onClose();
    try {
      await mkdir(trimmed);
    } catch {
      notice("Could not create folder.", { variant: "danger" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showClose={false}>
        <DialogTitle>New folder</DialogTitle>
        <DialogDescription>
          Nested folders work too, e.g. “Projects/Work”.
        </DialogDescription>
        <form onSubmit={submit}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-4"
            placeholder="Folder name"
            autoFocus
            aria-label="Folder name"
          />
          <DialogFooter>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit">
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
