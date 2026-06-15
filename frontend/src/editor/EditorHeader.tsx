import { useEffect, useRef, useState } from "react";
import { useNotesStore } from "@/store/notes-store";
import { openNote } from "@/core/navigation";
import { notice } from "@/components/ui/toast";
import { AppIcon } from "@/components/AppIcon";
import { MountHost } from "@/components/MountHost";
import { workspaceStore } from "@/core/workspace";
import { getIconAssignment, iconAssignmentStore } from "@/core/icon-assignments";
import { useStore } from "zustand";

/** Note title, doubling as a rename control — click to edit the filename. */
export function EditableTitle({ notePath }: { notePath: string }) {
  const folder = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
  const name = notePath.split("/").pop()!.replace(/\.md$/, "");
  const rename = useNotesStore((s) => s.rename);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  useStore(iconAssignmentStore, (state) => state.assignments);
  const icon = getIconAssignment({ kind: "note", path: notePath });

  useEffect(() => {
    setValue(name);
  }, [name]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = async () => {
    setEditing(false);
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) {
      setValue(name);
      return;
    }
    const newPath = folder ? `${folder}/${trimmed}.md` : `${trimmed}.md`;
    try {
      const meta = await rename(notePath, newPath);
      openNote(meta.path);
      notice(`Renamed to “${trimmed}”.`, {
        duration: 6000,
        action: {
          label: "Undo",
          run: async () => {
            const restored = await rename(newPath, notePath);
            openNote(restored.path);
          },
        },
      });
    } catch {
      setValue(name);
      notice("Rename failed — is the name taken?", { variant: "danger" });
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            setValue(name);
            setEditing(false);
          }
        }}
        className="w-full rounded-sm bg-transparent text-2xl font-semibold tracking-[-0.025em] outline-none ring-2 ring-accent"
        aria-label="Note title"
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      {icon && <AppIcon icon={icon} fallback="note" size={22} className="text-faint" />}
      <h1
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setEditing(true);
          }
        }}
        className="-mx-1 min-w-0 flex-1 cursor-text truncate rounded-sm px-1 text-2xl font-semibold tracking-[-0.025em] hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        title="Click to rename"
      >
        {name}
      </h1>
      <NoteToolbar notePath={notePath} />
    </div>
  );
}

/** Plugin-registered controls shown alongside the note title. */
export function NoteToolbar({ notePath }: { notePath: string }) {
  const items = useStore(workspaceStore, (s) => s.noteToolbarItems);
  if (items.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {items.map((item) => (
        <MountHost
          key={item.id}
          mount={(el) => item.mount(el, notePath)}
          className="flex items-center"
        />
      ))}
    </div>
  );
}
