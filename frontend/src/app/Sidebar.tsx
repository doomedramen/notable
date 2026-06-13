import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useStore } from "zustand";
import { SwipeBarLeft, useSwipeBarContext } from "@luciodale/swipe-bar";
import { useNotesStore, syncNotesList } from "../store/notes-store";
import { useUI } from "../store/ui";
import { workspaceStore } from "../core/workspace";
import { openNote } from "../core/navigation";
import { MountHost } from "../components/MountHost";
import type { NoteMeta } from "../store/notes";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tooltip } from "../components/ui/tooltip";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton } from "../components/ui/skeleton";
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
import { AppIcon } from "../components/AppIcon";
import {
  getIconAssignment,
  iconAssignmentStore,
} from "../core/icon-assignments";

const MOBILE_DRAWER_WIDTH = 288;
const SWIPE_EDGE_WIDTH = 40;
const SWIPE_ACTIVATION_DELTA = 20;
const SWIPE_TRANSITION_MS = 200;

/** Tracks the md breakpoint (768px) so sidebarBody is only mounted into
    whichever of the two wrappers (desktop aside / mobile drawer) is
    actually visible — otherwise both copies sit in the DOM and produce
    duplicate accessible elements (e.g. two `<nav>`s, two "New…" buttons). */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

/** The drawer package only reveals its overlay after the open state settles.
    This companion layer follows an edge drag so the page dims immediately,
    then cross-fades into the package's clickable overlay. */
function MobileSwipeBackdrop() {
  const { leftSidebars } = useSwipeBarContext();
  const drawerOpen = leftSidebars.sidebar?.isOpen ?? false;
  const backdropRef = useRef<HTMLDivElement>(null);
  const touchIdRef = useRef<number | null>(null);
  const startXRef = useRef<number | null>(null);
  const previousXRef = useRef<number | null>(null);
  const lastXRef = useRef<number | null>(null);
  const activatedRef = useRef(false);

  const setOpacity = (opacity: number, animate: boolean) => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    backdrop.style.transition = animate
      ? `opacity ${SWIPE_TRANSITION_MS}ms ease`
      : "none";
    backdrop.style.opacity = String(opacity);
  };

  useEffect(() => {
    if (!drawerOpen) return;
    // The built-in overlay starts fading in now. Cross-fade this drag layer
    // out instead of dropping the dimming for a frame at handoff.
    const frame = requestAnimationFrame(() => setOpacity(0, true));
    return () => cancelAnimationFrame(frame);
  }, [drawerOpen]);

  useLayoutEffect(() => {
    const findTouch = (touches: TouchList, id: number) => {
      for (let index = 0; index < touches.length; index += 1) {
        const touch = touches[index];
        if (touch?.identifier === id) return touch;
      }
      return null;
    };

    const resetGesture = () => {
      touchIdRef.current = null;
      startXRef.current = null;
      previousXRef.current = null;
      lastXRef.current = null;
      activatedRef.current = false;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (drawerOpen || event.changedTouches.length === 0) return;
      const touch = event.changedTouches[0];
      if (!touch || touch.clientX > SWIPE_EDGE_WIDTH) return;
      touchIdRef.current = touch.identifier;
      startXRef.current = touch.clientX;
      previousXRef.current = touch.clientX;
      lastXRef.current = touch.clientX;
      activatedRef.current = false;
      setOpacity(0, false);
    };

    const onTouchMove = (event: TouchEvent) => {
      const touchId = touchIdRef.current;
      const startX = startXRef.current;
      if (touchId === null || startX === null) return;
      const touch = findTouch(event.changedTouches, touchId);
      if (!touch) return;
      const delta = touch.clientX - startX;
      if (
        !activatedRef.current &&
        Math.abs(delta) >= SWIPE_ACTIVATION_DELTA
      ) {
        activatedRef.current = true;
      }
      if (!activatedRef.current) return;
      previousXRef.current = lastXRef.current;
      lastXRef.current = touch.clientX;
      const revealed = Math.max(
        0,
        delta - SWIPE_ACTIVATION_DELTA,
      );
      setOpacity(Math.min(1, revealed / MOBILE_DRAWER_WIDTH), false);
    };

    const onTouchEnd = () => {
      const touchId = touchIdRef.current;
      const startX = startXRef.current;
      if (touchId === null || startX === null) return;
      const currentX = lastXRef.current ?? startX;
      const previousX = previousXRef.current ?? startX;
      const willOpen =
        activatedRef.current && currentX >= previousX;
      setOpacity(willOpen ? 1 : 0, true);
      resetGesture();
    };

    const onTouchCancel = () => {
      setOpacity(0, true);
      resetGesture();
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [drawerOpen]);

  return (
    <div
      ref={backdropRef}
      data-testid="sidebar-swipe-backdrop"
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[30] bg-black/50 opacity-0 md:hidden"
    />
  );
}

export function Sidebar() {
  const notes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);
  const loaded = useNotesStore((s) => s.loaded);
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
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const isMobile = useIsMobile();

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

  // Shared sidebar contents, rendered into both the desktop static panel
  // and the mobile swipe-bar drawer below.
  const sidebarBody = (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
        <span className="flex-1 text-sm font-semibold tracking-tight select-none">
          Notable
        </span>
        <Tooltip label="Settings" disabled={isMobile}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => useUI.getState().setSettingsOpen(true)}
            aria-label="Settings"
          >
            <AppIcon icon="settings" size={15} />
          </Button>
        </Tooltip>
        <Tooltip label="Hide sidebar" disabled={isMobile}>
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Hide sidebar">
            <AppIcon icon="sidebar" size={15} />
          </Button>
        </Tooltip>
        <DropdownMenu>
          <Tooltip label="New…" disabled={isMobile}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="New…">
                <AppIcon icon="add" size={16} />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => void handleCreate()}>
              <AppIcon icon="note" size={14} className="text-muted" />
              New note
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setNewFolderOpen(true)}>
              <AppIcon icon="folder-add" size={14} className="text-muted" />
              New folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav className="flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
        {!loaded ? (
          <div className="space-y-1 px-2 py-2">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-3/4" />
          </div>
        ) : notes.length === 0 && groups.rest.length === 0 ? (
          <EmptyState icon="note">
            No notes yet. Create one to start writing.
          </EmptyState>
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
                onRenameFolder={() => setRenamingFolder(folder)}
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
            "flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm text-muted hover:bg-surface-hover hover:text-foreground",
            location.pathname === "/trash" && "bg-surface-hover text-foreground",
          )}
        >
          <AppIcon icon="trash" size={14} className="text-muted" />
          Trash
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop collapsed rail (mobile uses the top-bar hamburger). */}
      {!open && (
        <div className="hidden shrink-0 flex-col border-r border-border bg-surface p-1.5 md:flex">
          <Tooltip label="Show sidebar" side="right">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Show sidebar">
              <AppIcon icon="sidebar" size={15} />
            </Button>
          </Tooltip>
        </div>
      )}
      {/* Desktop: static panel, only rendered while expanded. */}
      {open && (
        <aside className="hidden shrink-0 flex-col border-r border-border bg-surface md:flex md:w-60">
          {!isMobile && sidebarBody}
        </aside>
      )}
      {/* Mobile: off-canvas drawer with edge-swipe and live drag-to-open. */}
      <MobileSwipeBackdrop />
      <SwipeBarLeft
        id="sidebar"
        ariaLabel="Sidebar"
        className="flex flex-col border-r border-border bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:hidden"
        sidebarWidthPx={MOBILE_DRAWER_WIDTH}
        isAbsolute
        mediaQueryWidth={768}
        transitionMs={SWIPE_TRANSITION_MS}
        swipeBarZIndex={40}
        overlayZIndex={30}
        showToggle={false}
      >
        {isMobile ? sidebarBody : <div aria-hidden />}
      </SwipeBarLeft>

      <RenameDialog note={renaming} onClose={() => setRenaming(null)} activePath={activePath} />
      <RenameFolderDialog
        folder={renamingFolder}
        onClose={() => setRenamingFolder(null)}
        activePath={activePath}
      />
      <DeleteDialog
        note={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        activePath={activePath}
      />
      <NewFolderDialog open={newFolderOpen} onClose={() => setNewFolderOpen(false)} />
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
  onRenameFolder,
  onDeleteFolder,
}: {
  folder: string;
  notes: NoteMeta[];
  activePath: string | null;
  onCreateNote: () => void;
  onRename: (n: NoteMeta) => void;
  onDelete: (n: NoteMeta) => void;
  onRenameFolder: () => void;
  onDeleteFolder: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const menuItems = useStore(
    workspaceStore,
    (state) => state.folderContextMenuItems,
  );
  useStore(iconAssignmentStore, (state) => state.assignments);
  const icon = getIconAssignment({ kind: "folder", path: folder }) ?? "folder";
  const contributed = menuItems.filter(
    (item) => !item.when || item.when(folder),
  );

  return (
    <section className="mt-1">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex w-full items-center gap-1.5 rounded-sm px-2 py-2 text-left text-sm text-muted hover:bg-surface-hover hover:text-foreground md:py-1.5"
          >
            <AppIcon
              icon="chevron-down"
              size={12}
              className={cn("shrink-0 transition-transform duration-200", collapsed && "-rotate-90")}
            />
            <AppIcon
              icon={icon}
              fallback="folder"
              size={14}
              className="shrink-0 text-faint"
            />
            <span className="truncate font-medium">{folder}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onCreateNote}>New note here</ContextMenuItem>
          <ContextMenuItem onSelect={onRenameFolder}>Rename folder…</ContextMenuItem>
          {contributed.map((item) => (
            <ContextMenuItem
              key={item.id}
              onSelect={() => item.run(folder)}
            >
              {item.icon && <AppIcon icon={item.icon} size={14} />}
              {item.label}
            </ContextMenuItem>
          ))}
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
  const menuItems = useStore(
    workspaceStore,
    (state) => state.noteContextMenuItems,
  );
  useStore(iconAssignmentStore, (state) => state.assignments);
  const icon = getIconAssignment({ kind: "note", path: note.path }) ?? "note";
  const contributed = menuItems.filter(
    (item) => !item.when || item.when(note.path),
  );
  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={onOpen}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-sm px-2 py-2 text-left text-sm transition-colors duration-100 md:py-1.5",
              active
                ? "bg-accent-soft text-foreground"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <AppIcon
              icon={icon}
              fallback="note"
              size={14}
              className={cn(
                "shrink-0",
                active ? "text-accent" : "text-faint",
              )}
            />
            <span className="truncate">{note.name}</span>
            {!hideFolder && note.folder && (
              <span className="ml-auto truncate text-xs text-faint">
                {note.folder}
              </span>
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onRename}>Rename…</ContextMenuItem>
          {contributed.map((item) => (
            <ContextMenuItem
              key={item.id}
              onSelect={() => item.run(note.path)}
            >
              {item.icon && <AppIcon icon={item.icon} size={14} />}
              {item.label}
            </ContextMenuItem>
          ))}
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

function RenameFolderDialog({
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
          <Button variant="dangerSolid" onClick={handleDelete}>
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
  // Panels (e.g. Tags) start collapsed; the user expands the ones they want.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (panels.length === 0) return null;

  return (
    <div className="shrink-0 overflow-y-auto overscroll-contain border-t border-border">
      {panels.map((panel) => {
        const open = expanded[panel.id] ?? false;
        return (
          <section key={panel.id}>
            <button
              onClick={() => setExpanded((e) => ({ ...e, [panel.id]: !open }))}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted hover:text-foreground"
            >
              <AppIcon
                icon="chevron-down"
                size={12}
                className={cn(
                  "transition-transform duration-200",
                  !open && "-rotate-90",
                )}
              />
              {panel.title}
            </button>
            {open && <MountHost mount={panel.mount} className="px-1.5 pb-2" />}
          </section>
        );
      })}
    </div>
  );
}
