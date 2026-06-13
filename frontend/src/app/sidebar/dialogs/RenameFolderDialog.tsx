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

export function RenameFolderDialog({
  folder,
  onClose,
  activePath,
}: {
  folder: string | null;
  onClose: () => void;
  activePath: string | null;
}) {
  const renameFolder = useNotesStore((s) => s.renameFolder);
  const folders = useNotesStore((s) => s.folders);
  const [name, setName] = useState("");

  useEffect(() => {
    if (folder) setName(folder.split("/").pop() ?? folder);
  }, [folder]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!folder) return;
    // Rename the leaf segment only — keep the folder where it is.
    const leaf = name.trim().replace(/^\/+|\/+$/g, "");
    const parent = folder.includes("/")
      ? folder.slice(0, folder.lastIndexOf("/"))
      : "";
    const target = parent ? `${parent}/${leaf}` : leaf;
    if (!leaf || target === folder) {
      onClose();
      return;
    }
    if (leaf.includes("/")) {
      notice("Folder names can’t contain “/”.", { variant: "danger" });
      return;
    }
    if (folders.includes(target)) {
      notice("A folder with that name already exists.", { variant: "danger" });
      return;
    }
    const movingActive =
      activePath === folder || activePath?.startsWith(`${folder}/`);
    onClose();
    try {
      await renameFolder(folder, target);
      // Follow the open note to its new path so it stays selected.
      if (movingActive && activePath) {
        openNote(`${target}${activePath.slice(folder.length)}`);
      }
      notice(`Renamed folder to “${target}”.`, {
        duration: 6000,
        action: {
          label: "Undo",
          run: async () => {
            await renameFolder(target, folder);
            if (movingActive && activePath) openNote(activePath);
          },
        },
      });
    } catch {
      notice("Could not rename folder.", { variant: "danger" });
    }
  };

  return (
    <Dialog open={folder !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showClose={false}>
        <DialogTitle>Rename folder</DialogTitle>
        <form onSubmit={submit}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-4"
            autoFocus
            onFocus={(e) => e.target.select()}
            aria-label="New folder name"
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
