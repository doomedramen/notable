import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useStore } from "zustand";
import { useNotesStore, syncNotesList } from "../store/notes-store";
import { useUI } from "../store/ui";
import { workspaceStore } from "../core/workspace";
import { openNote } from "../core/navigation";
import { MountHost } from "../components/MountHost";
import type { NoteMeta } from "../store/notes";
import type { IconSource } from "../plugin-api";
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
import {
  Sheet,
  SheetContent,
  SheetOverlay,
  SheetPortal,
} from "../components/ui/sheet";
import { cn } from "../lib/cn";
import { AppIcon } from "../components/AppIcon";
import { useMobileSidebarGesture } from "./useMobileSidebarGesture";
import {
  getIconAssignment,
  iconAssignmentStore,
} from "../core/icon-assignments";

const MOBILE_DRAWER_WIDTH = 288;

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

export function Sidebar() {
  const notes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);
  const loaded = useNotesStore((s) => s.loaded);
  const trash = useNotesStore((s) => s.trash);
  const restore = useNotesStore((s) => s.restore);
  const rename = useNotesStore((s) => s.rename);
  const rmdir = useNotesStore((s) => s.rmdir);
  const open = useUI((s) => s.sidebarOpen);
  const toggle = useUI((s) => s.toggleSidebar);
  const mobileOpen = useUI((s) => s.mobileSidebarOpen);
  const setMobileOpen = useUI((s) => s.setMobileSidebarOpen);
  const settingsOpen = useUI((s) => s.settingsOpen);
  const paletteOpen = useUI((s) => s.paletteOpen);
  const quickNoteOpen = useUI((s) => s.quickNoteOpen);
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const activePath = params["*"] ?? null;
  const [renaming, setRenaming] = useState<NoteMeta | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const mobileSidebarRef = useRef<HTMLDivElement>(null);
  const touchDragRef = useRef<{
    path: string;
    active: boolean;
    timer: number;
    targetFolder: string | null;
    startX: number;
    startY: number;
  } | null>(null);
  const isMobile = useIsMobile();
  const modalOpen = settingsOpen || paletteOpen || quickNoteOpen;
  const {
    contentStyle,
    overlayStyle,
    gestureActive,
    contentHandlers,
  } = useMobileSidebarGesture({
    open: mobileOpen,
    setOpen: setMobileOpen,
    disabled: modalOpen,
    width: MOBILE_DRAWER_WIDTH,
    contentRef: mobileSidebarRef,
  });

  const sidebarSortComparators = useStore(
    workspaceStore,
    (state) => state.sidebarSortComparators,
  );

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
    const compare = sidebarSortComparators[sidebarSortComparators.length - 1];
    if (compare) {
      root.sort(compare);
      for (const [, folderNotes] of rest) folderNotes.sort(compare);
    }
    return { root, rest };
  }, [notes, folders, sidebarSortComparators]);

  // Display order of note paths, used for shift-click range selection.
  const noteOrder = useMemo(
    () => [
      ...groups.root.map((n) => n.path),
      ...groups.rest.flatMap(([, folderNotes]) => folderNotes.map((n) => n.path)),
    ],
    [groups],
  );

  const handleNoteClick = (note: NoteMeta, event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(note.path)) next.delete(note.path);
        else next.add(note.path);
        return next;
      });
      setSelectionAnchor(note.path);
      return;
    }
    if (event.shiftKey && selectionAnchor) {
      event.preventDefault();
      const from = noteOrder.indexOf(selectionAnchor);
      const to = noteOrder.indexOf(note.path);
      if (from === -1 || to === -1) {
        setSelected(new Set([note.path]));
      } else {
        const [start, end] = from < to ? [from, to] : [to, from];
        setSelected(new Set(noteOrder.slice(start, end + 1)));
      }
      return;
    }
    setSelected(new Set());
    setSelectionAnchor(note.path);
    openNote(note.path);
  };

  /** Selected paths for context-menu callbacks, with `path` always first. */
  const selectionFor = (path: string): string[] =>
    selected.has(path)
      ? [path, ...[...selected].filter((p) => p !== path)]
      : [path];

  const ensureSelected = (path: string) => {
    if (!selected.has(path)) {
      setSelected(new Set([path]));
      setSelectionAnchor(path);
    }
  };

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

  useEffect(() => {
    if (selected.size === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(new Set());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected.size]);

  const handleCreate = (folder = "") => useUI.getState().openQuickNote(folder);

  const handleTrash = async (paths: string[]) => {
    const targets = paths
      .map((path) => notes.find((note) => note.path === path))
      .filter((note): note is NoteMeta => note !== undefined);
    if (targets.length === 0) return;
    const activeWasTrashed = targets.some((note) => note.path === activePath);
    try {
      await Promise.all(targets.map((note) => trash(note.path)));
      setSelected(new Set());
      if (activeWasTrashed) navigate("/");
      notice(
        targets.length === 1
          ? `Moved “${targets[0]!.name}” to Trash.`
          : `Moved ${targets.length} notes to Trash.`,
        {
          duration: 6000,
          action: {
            label: "Undo",
            run: async () => {
              const restored = await Promise.all(
                targets.map((note) => restore(note.path)),
              );
              if (activeWasTrashed && restored[0]) {
                openNote(restored[0].path);
              }
            },
          },
        },
      );
    } catch {
      notice("Could not move the note to Trash.", { variant: "danger" });
      await syncNotesList();
    }
  };

  const moveNote = async (path: string, folder: string) => {
    const note = notes.find((item) => item.path === path);
    if (!note || note.folder === folder) return;
    const target = folder ? `${folder}/${note.name}.md` : `${note.name}.md`;
    const wasActive = path === activePath;
    try {
      const moved = await rename(path, target);
      if (wasActive) openNote(moved.path);
      notice(`Moved “${note.name}” to ${folder || "Root"}.`, {
        duration: 6000,
        action: {
          label: "Undo",
          run: async () => {
            const restored = await rename(target, path);
            if (wasActive) openNote(restored.path);
          },
        },
      });
    } catch {
      notice("Could not move the note. Is that name already taken?", {
        variant: "danger",
      });
    }
  };

  const finishTouchDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = touchDragRef.current;
    if (!drag) return;
    clearTimeout(drag.timer);
    if (drag.active && drag.targetFolder !== null) {
      event.preventDefault();
      void moveNote(drag.path, drag.targetFolder);
    }
    touchDragRef.current = null;
    setDraggedPath(null);
    setDragOverFolder(null);
  };

  const touchDragHandlers = (path: string) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== "touch") return;
      const drag = {
        path,
        active: false,
        targetFolder: null as string | null,
        startX: event.clientX,
        startY: event.clientY,
        timer: window.setTimeout(() => {
          drag.active = true;
          setDraggedPath(path);
        }, 280),
      };
      touchDragRef.current = drag;
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const drag = touchDragRef.current;
      if (
        drag &&
        !drag.active &&
        Math.hypot(
          event.clientX - drag.startX,
          event.clientY - drag.startY,
        ) >= 12
      ) {
        clearTimeout(drag.timer);
        touchDragRef.current = null;
        return;
      }
      if (!drag?.active) return;
      event.preventDefault();
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-folder-drop]");
      const folder = target?.dataset.folderDrop;
      drag.targetFolder = folder ?? null;
      setDragOverFolder(folder ?? null);
      const nav = navRef.current;
      if (nav) {
        const bounds = nav.getBoundingClientRect();
        if (event.clientY < bounds.top + 48) nav.scrollTop -= 12;
        if (event.clientY > bounds.bottom - 48) nav.scrollTop += 12;
      }
    },
    onPointerUp: finishTouchDrag,
    onPointerCancel: finishTouchDrag,
  });

  const handleDeleteFolder = async (folder: string) => {
    if (!(await confirm(`Delete the empty folder “${folder}”?`))) return;
    try {
      await rmdir(folder);
    } catch {
      notice("Folder is not empty.", { variant: "danger" });
    }
  };

  // Shared sidebar contents, rendered into either the desktop static panel
  // or the mobile Radix sheet.
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
          <Button
            variant="ghost"
            size="icon"
            onClick={isMobile ? () => setMobileOpen(false) : toggle}
            aria-label="Hide sidebar"
          >
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

      <nav
        ref={navRef}
        className="flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2"
      >
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
            <ul
              data-folder-drop=""
              onDragOver={(event) => {
                event.preventDefault();
                setDragOverFolder("");
              }}
              onDragLeave={() => setDragOverFolder(null)}
              onDrop={(event) => {
                event.preventDefault();
                const path =
                  event.dataTransfer.getData("text/notable-note") || draggedPath;
                if (path) void moveNote(path, "");
                setDraggedPath(null);
                setDragOverFolder(null);
              }}
              className={cn(
                "min-h-2 rounded-sm transition-colors",
                draggedPath && dragOverFolder === "" && "bg-accent-soft",
              )}
            >
              {groups.root.map((note) => (
                <NoteRow
                  key={note.path}
                  note={note}
                  active={note.path === activePath}
                  selected={selected.has(note.path)}
                  selectedPaths={selectionFor(note.path)}
                  onClick={(event) => handleNoteClick(note, event)}
                  onContextMenu={() => ensureSelected(note.path)}
                  onRename={() => setRenaming(note)}
                  onDelete={() => void handleTrash(selectionFor(note.path))}
                  onDragStart={() => setDraggedPath(note.path)}
                  onDragEnd={() => {
                    setDraggedPath(null);
                    setDragOverFolder(null);
                  }}
                  touchDragHandlers={touchDragHandlers(note.path)}
                />
              ))}
            </ul>
            {groups.rest.map(([folder, folderNotes]) => (
              <FolderGroup
                key={folder}
                folder={folder}
                notes={folderNotes}
                activePath={activePath}
                selected={selected}
                selectionFor={selectionFor}
                onNoteClick={handleNoteClick}
                onNoteContextMenu={ensureSelected}
                onCreateNote={() => handleCreate(folder)}
                onRename={setRenaming}
                onDelete={(note) =>
                  void handleTrash(selectionFor(note.path))
                }
                onRenameFolder={() => setRenamingFolder(folder)}
                onDeleteFolder={() => void handleDeleteFolder(folder)}
                draggedPath={draggedPath}
                dragOverFolder={dragOverFolder}
                onDragOverFolder={setDragOverFolder}
                onDropNote={(path) => void moveNote(path, folder)}
                onDragStart={setDraggedPath}
                onDragEnd={() => {
                  setDraggedPath(null);
                  setDragOverFolder(null);
                }}
                touchDragHandlers={touchDragHandlers}
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
      {/* Mobile: Radix modal sheet with local edge-open/drag-close gestures. */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetPortal>
          <SheetOverlay
            data-testid="sidebar-swipe-backdrop"
            style={overlayStyle}
          />
          <SheetContent
            ref={mobileSidebarRef}
            title="Sidebar"
            description="Navigate notes, folders, and application views."
            tabIndex={-1}
            style={{
              width: MOBILE_DRAWER_WIDTH,
              ...contentStyle,
            }}
            className="flex touch-pan-y flex-col border-r border-border bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:hidden"
            onOpenAutoFocus={(event) => {
              if (gestureActive) event.preventDefault();
            }}
            {...contentHandlers}
          >
            {isMobile ? sidebarBody : <div aria-hidden />}
          </SheetContent>
        </SheetPortal>
      </Sheet>

      <RenameDialog note={renaming} onClose={() => setRenaming(null)} activePath={activePath} />
      <RenameFolderDialog
        folder={renamingFolder}
        onClose={() => setRenamingFolder(null)}
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
  selected,
  selectionFor,
  onNoteClick,
  onNoteContextMenu,
  onCreateNote,
  onRename,
  onDelete,
  onRenameFolder,
  onDeleteFolder,
  draggedPath,
  dragOverFolder,
  onDragOverFolder,
  onDropNote,
  onDragStart,
  onDragEnd,
  touchDragHandlers,
}: {
  folder: string;
  notes: NoteMeta[];
  activePath: string | null;
  selected: ReadonlySet<string>;
  selectionFor: (path: string) => string[];
  onNoteClick: (note: NoteMeta, event: MouseEvent) => void;
  onNoteContextMenu: (path: string) => void;
  onCreateNote: () => void;
  onRename: (n: NoteMeta) => void;
  onDelete: (n: NoteMeta) => void;
  onRenameFolder: () => void;
  onDeleteFolder: () => void;
  draggedPath: string | null;
  dragOverFolder: string | null;
  onDragOverFolder: (folder: string | null) => void;
  onDropNote: (path: string) => void;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
  touchDragHandlers: (
    path: string,
  ) => {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  };
}) {
  const collapsed = useUI((state) => state.collapsedFolders.includes(folder));
  const toggleCollapsed = useUI((state) => state.toggleFolderCollapsed);
  const menuItems = useStore(
    workspaceStore,
    (state) => state.folderContextMenuItems,
  );
  useStore(iconAssignmentStore, (state) => state.assignments);
  const icon = getIconAssignment({ kind: "folder", path: folder }) ?? "folder";
  const contributed = menuItems.filter(
    (item) => !item.when || item.when(folder, [folder]),
  );

  return (
    <section className="mt-1">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            data-folder-drop={folder}
            onClick={() => toggleCollapsed(folder)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" && !collapsed) {
                event.preventDefault();
                toggleCollapsed(folder);
              } else if (event.key === "ArrowRight" && collapsed) {
                event.preventDefault();
                toggleCollapsed(folder);
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              onDragOverFolder(folder);
            }}
            onDragLeave={() => onDragOverFolder(null)}
            onDrop={(event) => {
              event.preventDefault();
              const path =
                event.dataTransfer.getData("text/notable-note") || draggedPath;
              if (path) onDropNote(path);
              onDragEnd();
            }}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-sm px-2 py-2 text-left text-sm text-muted hover:bg-surface-hover hover:text-foreground md:py-1.5",
              draggedPath &&
                dragOverFolder === folder &&
                "bg-accent-soft text-foreground ring-1 ring-accent",
            )}
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
              onSelect={() => item.run(folder, [folder])}
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
              selected={selected.has(note.path)}
              selectedPaths={selectionFor(note.path)}
              onClick={(event) => onNoteClick(note, event)}
              onContextMenu={() => onNoteContextMenu(note.path)}
              onRename={() => onRename(note)}
              onDelete={() => onDelete(note)}
              onDragStart={() => onDragStart(note.path)}
              onDragEnd={onDragEnd}
              touchDragHandlers={touchDragHandlers(note.path)}
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
  selected = false,
  selectedPaths,
  onClick,
  onContextMenu,
  onRename,
  onDelete,
  onDragStart,
  onDragEnd,
  touchDragHandlers,
  hideFolder = false,
}: {
  note: NoteMeta;
  active: boolean;
  selected?: boolean;
  selectedPaths?: string[];
  onClick: (event: MouseEvent) => void;
  onContextMenu?: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  touchDragHandlers: {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  };
  hideFolder?: boolean;
}) {
  const menuItems = useStore(
    workspaceStore,
    (state) => state.noteContextMenuItems,
  );
  const decorators = useStore(
    workspaceStore,
    (state) => state.noteDecorators,
  );
  useStore(iconAssignmentStore, (state) => state.assignments);
  let badge: string | undefined;
  let iconOverride: IconSource | undefined;
  for (const decorate of decorators) {
    const result = decorate(note);
    if (!result) continue;
    if (result.badge !== undefined) badge = result.badge;
    if (result.icon !== undefined) iconOverride = result.icon;
  }
  const icon =
    iconOverride ?? getIconAssignment({ kind: "note", path: note.path }) ?? "note";
  const paths = selectedPaths ?? [note.path];
  const contributed = menuItems.filter(
    (item) => !item.when || item.when(note.path, paths),
  );
  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            data-note-row
            data-note-path={note.path}
            draggable
            onClick={onClick}
            onContextMenu={onContextMenu}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/notable-note", note.path);
              onDragStart();
            }}
            onDragEnd={onDragEnd}
            onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
              if (event.key === "F2") {
                event.preventDefault();
                onRename();
              } else if (event.key === "Delete") {
                event.preventDefault();
                onDelete();
              } else if (
                event.key === "ArrowDown" ||
                event.key === "ArrowUp"
              ) {
                event.preventDefault();
                const rows = [
                  ...(event.currentTarget
                    .closest("nav")
                    ?.querySelectorAll<HTMLButtonElement>("[data-note-row]") ??
                    []),
                ];
                const index = rows.indexOf(event.currentTarget);
                rows[
                  event.key === "ArrowDown"
                    ? Math.min(rows.length - 1, index + 1)
                    : Math.max(0, index - 1)
                ]?.focus();
              }
            }}
            {...touchDragHandlers}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-sm px-2 py-2 text-left text-sm transition-colors duration-100 md:py-1.5",
              active
                ? "bg-accent-soft text-foreground"
                : selected
                  ? "bg-surface-hover text-foreground"
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
            {badge && (
              <span className="shrink-0 rounded-sm bg-surface-hover px-1 text-xs text-faint">
                {badge}
              </span>
            )}
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
              onSelect={() => item.run(note.path, paths)}
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
