import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useStore } from "zustand";
import {
  ChevronDown,
  FileText,
  Folder,
  FolderPlus,
  PanelLeft,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import { useNotesStore, syncNotesList } from "../store/notes-store";
import { useUI } from "../store/ui";
import { workspaceStore } from "../core/workspace";
import { openNote } from "../core/navigation";
import { MountHost } from "../components/MountHost";
import type { NoteMeta } from "../store/notes";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tooltip } from "../components/ui/tooltip";
import { notice } from "../components/ui/toast";
import { confirm } from "../components/ui/confirm";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { cn } from "../lib/cn";

export function Sidebar() {
  const notes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);
  const create = useNotesStore((s) => s.create);
  const rmdir = useNotesStore((s) => s.rmdir);
  const open = useUI((s) => s.sidebarOpen);
  const toggle = useUI((s) => s.toggleSidebar);
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const activePath = params["*"] ?? null;
  const [confirmDelete, setConfirmDelete] = useState<NoteMeta | null>(null);
  const [renaming, setRenaming] = useState<NoteMeta | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  // Group notes by folder; include empty folders from the listing.
  const groups = useMemo(() => {
    const map = new Map<string, NoteMeta[]>();
    for (const f of folders) map.set(f, []);
    for (const n of notes) {
      const list = map.get(n.folder);
      if (list) list.push(n);
      else map.set(n.folder, [n]);
    }
    const root = map.get("") ?? [];
    map.delete("");
    const rest = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    return { root, rest };
  }, [notes, folders]);

  useEffect(() => {
    void syncNotesList();
    const onReachable = () => void syncNotesList();
    // "online" fires when the browser regains any network; the custom
    // event fires when the sync socket actually reaches OUR server
    // (the two differ for self-hosted servers on a home network).
    window.addEventListener("online", onReachable);
    window.addEventListener("notable:server-reachable", onReachable);
    // Periodic sweep: retries queued mutations even if no editor is
    // open to probe the server, and keeps the list fresh.
    const interval = setInterval(onReachable, 30_000);
    return () => {
      window.removeEventListener("online", onReachable);
      window.removeEventListener("notable:server-reachable", onReachable);
      clearInterval(interval);
    };
  }, []);

  const handleCreate = async (folder = "") => {
    const meta = await create("Untitled", folder);
    openNote(meta.path);
  };

  const handleDeleteFolder = async (folder: string) => {
    if (!(await confirm(`Delete the empty folder “${folder}”?`))) return;
    try {
      await rmdir(folder);
    } catch {
      notice("Folder is not empty.", { variant: "danger" });
    }
  };

  return (
    <>
      {/* Desktop collapsed rail (mobile uses the top-bar hamburger). */}
      {!open && (
        <div className="hidden shrink-0 flex-col border-r border-border bg-surface p-1.5 md:flex">
          <Tooltip label="Show sidebar" side="right">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Show sidebar">
              <PanelLeft size={15} />
            </Button>
          </Tooltip>
        </div>
      )}
      {/* Mobile: off-canvas drawer. Desktop: static panel. */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] shrink-0 flex-col border-r border-border bg-surface pt-[env(safe-area-inset-top)] transition-transform duration-200 md:static md:z-auto md:w-60 md:max-w-none md:pt-0 md:transition-none",
          open ? "translate-x-0" : "-translate-x-full",
          !open && "md:hidden",
        )}
        data-testid="sidebar"
      >
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <span className="flex-1 text-[13px] font-semibold tracking-tight select-none">
          Notable
        </span>
        <Tooltip label="Settings">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => useUI.getState().setSettingsOpen(true)}
            aria-label="Settings"
          >
            <Settings size={15} />
          </Button>
        </Tooltip>
        <Tooltip label="Hide sidebar">
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Hide sidebar">
            <PanelLeft size={15} />
          </Button>
        </Tooltip>
        <DropdownMenu>
          <Tooltip label="New…">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="New…">
                <Plus size={16} />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => void handleCreate()}>
              <FileText size={14} className="text-muted" />
              New note
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setNewFolderOpen(true)}>
              <FolderPlus size={14} className="text-muted" />
              New folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav className="flex-1 overflow-y-auto px-1.5 pb-2">
        {notes.length === 0 && groups.rest.length === 0 ? (
          <p className="px-2 py-4 text-[13px] text-faint">
            No notes yet. Create one to start writing.
          </p>
        ) : (
          <>
            <ul>
              {groups.root.map((note) => (
                <NoteRow
                  key={note.path}
                  note={note}
                  active={note.path === activePath}
                  onOpen={() => openNote(note.path)}
                  onRename={() => setRenaming(note)}
                  onDelete={() => setConfirmDelete(note)}
                />
              ))}
            </ul>
            {groups.rest.map(([folder, folderNotes]) => (
              <FolderGroup
                key={folder}
                folder={folder}
                notes={folderNotes}
                activePath={activePath}
                onCreateNote={() => void handleCreate(folder)}
                onRename={setRenaming}
                onDelete={setConfirmDelete}
                onDeleteFolder={() => void handleDeleteFolder(folder)}
              />
            ))}
          </>
        )}
      </nav>

      <SidebarPanels />

      <div className="border-t border-border px-1.5 py-1.5">
        <button
          onClick={() => navigate("/trash")}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] text-muted hover:bg-surface-hover hover:text-foreground",
            location.pathname === "/trash" && "bg-surface-hover text-foreground",
          )}
        >
          <Trash2 size={14} className="text-muted" />
          Trash
        </button>
      </div>

        <RenameDialog note={renaming} onClose={() => setRenaming(null)} activePath={activePath} />
        <DeleteDialog
          note={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          activePath={activePath}
        />
        <NewFolderDialog open={newFolderOpen} onClose={() => setNewFolderOpen(false)} />
      </aside>
    </>
  );
}

function FolderGroup({
  folder,
  notes,
  activePath,
  onCreateNote,
  onRename,
  onDelete,
  onDeleteFolder,
}: {
  folder: string;
  notes: NoteMeta[];
  activePath: string | null;
  onCreateNote: () => void;
  onRename: (n: NoteMeta) => void;
  onDelete: (n: NoteMeta) => void;
  onDeleteFolder: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="mt-1">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex w-full items-center gap-1.5 rounded-sm px-2 py-2 text-left text-[13px] text-muted hover:bg-surface-hover hover:text-foreground md:py-1.5"
          >
            <ChevronDown
              size={12}
              className={cn("shrink-0 transition-transform", collapsed && "-rotate-90")}
            />
            <Folder size={14} className="shrink-0 text-faint" />
            <span className="truncate font-medium">{folder}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onCreateNote}>New note here</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem danger onSelect={onDeleteFolder}>
            Delete folder
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {!collapsed && (
        <ul className="ml-3 border-l border-border pl-1">
          {notes.map((note) => (
            <NoteRow
              key={note.path}
              note={note}
              active={note.path === activePath}
              onOpen={() => openNote(note.path)}
              onRename={() => onRename(note)}
              onDelete={() => onDelete(note)}
              hideFolder
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function NewFolderDialog({
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

function NoteRow({
  note,
  active,
  onOpen,
  onRename,
  onDelete,
  hideFolder = false,
}: {
  note: NoteMeta;
  active: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  hideFolder?: boolean;
}) {
  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={onOpen}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-[13px] transition-colors duration-75 md:py-1.5",
              active
                ? "bg-accent-soft text-foreground"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <FileText size={14} className={cn("shrink-0", active ? "text-accent" : "text-faint")} />
            <span className="truncate">{note.name}</span>
            {!hideFolder && note.folder && (
              <span className="ml-auto truncate text-[11px] text-faint">
                {note.folder}
              </span>
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onRename}>Rename…</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem danger onSelect={onDelete}>
            Delete note
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}

function RenameDialog({
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

function DeleteDialog({
  note,
  onClose,
  activePath,
}: {
  note: NoteMeta | null;
  onClose: () => void;
  activePath: string | null;
}) {
  const trash = useNotesStore((s) => s.trash);
  const navigate = useNavigate();

  const handleDelete = async () => {
    if (!note) return;
    const wasActive = note.path === activePath;
    onClose();
    await trash(note.path);
    if (wasActive) navigate("/");
  };

  return (
    <Dialog open={note !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showClose={false}>
        <DialogTitle>Delete “{note?.name}”?</DialogTitle>
        <DialogDescription>
          {note ? `“${note.path}” will be moved to Trash.` : ""}
        </DialogDescription>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            className="bg-danger text-white"
            onClick={handleDelete}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Plugin-registered sidebar panels, collapsible below the note list. */
function SidebarPanels() {
  const panels = useStore(workspaceStore, (s) => s.sidebarPanels);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  if (panels.length === 0) return null;

  return (
    <div className="shrink-0 overflow-y-auto border-t border-border">
      {panels.map((panel) => (
        <section key={panel.id}>
          <button
            onClick={() =>
              setCollapsed((c) => ({ ...c, [panel.id]: !c[panel.id] }))
            }
            className="flex w-full items-center gap-1 px-3 py-2 text-xs font-medium text-muted hover:text-foreground"
          >
            <ChevronDown
              size={12}
              className={cn(
                "transition-transform",
                collapsed[panel.id] && "-rotate-90",
              )}
            />
            {panel.title}
          </button>
          {!collapsed[panel.id] && (
            <MountHost mount={panel.mount} className="px-1.5 pb-2" />
          )}
        </section>
      ))}
    </div>
  );
}
