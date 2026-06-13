import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useStore } from "zustand";
import { useNotesStore, syncNotesList } from "@/store/notes-store";
import { useUI } from "@/store/ui";
import { workspaceStore } from "@/core/workspace";
import { openNote } from "@/core/navigation";
import type { NoteMeta } from "@/store/notes";
import type { IconSource } from "@/plugin-api";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { notice } from "@/components/ui/toast";
import { confirm } from "@/components/ui/confirm";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetOverlay,
  SheetPortal,
} from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { AppIcon } from "@/components/AppIcon";
import { useMobileSidebarGesture } from "./sidebar/hooks/useMobileSidebarGesture";
import { useSidebarSelection } from "./sidebar/hooks/useSidebarSelection";
import {
  useNoteDragAndDrop,
  type ItemDragHandlers,
  type FolderDropHandlers,
} from "./sidebar/hooks/useNoteDragAndDrop";
import {
  getIconAssignment,
  iconAssignmentStore,
} from "@/core/icon-assignments";
import { SidebarPanels } from "./sidebar/SidebarPanels";
import { NewFolderDialog } from "./sidebar/dialogs/NewFolderDialog";
import { RenameNoteDialog } from "./sidebar/dialogs/RenameNoteDialog";
import { RenameFolderDialog } from "./sidebar/dialogs/RenameFolderDialog";

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
  const renameFolder = useNotesStore((s) => s.renameFolder);
  const rmdir = useNotesStore((s) => s.rmdir);
  const createNote = useNotesStore((s) => s.create);
  const open = useUI((s) => s.sidebarOpen);
  const toggle = useUI((s) => s.toggleSidebar);
  const mobileOpen = useUI((s) => s.mobileSidebarOpen);
  const setMobileOpen = useUI((s) => s.setMobileSidebarOpen);
  const settingsOpen = useUI((s) => s.settingsOpen);
  const paletteOpen = useUI((s) => s.paletteOpen);
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const activePath = params["*"] ?? null;
  const [renaming, setRenaming] = useState<NoteMeta | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const mobileSidebarRef = useRef<HTMLDivElement>(null);
  const noteDragActiveRef = useRef(false);
  const isMobile = useIsMobile();
  const modalOpen = settingsOpen || paletteOpen;
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
    suppressedRef: noteDragActiveRef,
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

  const { selected, selectionFor, handleNoteClick, ensureSelected, clearSelection } =
    useSidebarSelection(noteOrder);

  const {
    draggedPath,
    dragOverFolder,
    getNoteDragHandlers,
    getFolderDragHandlers,
    getFolderDropHandlers,
  } = useNoteDragAndDrop({
    navRef,
    onMoveNote: (path, folder) => void moveNote(path, folder),
    onMoveFolder: (path, folder) => void moveFolder(path, folder),
    noteDragActiveRef,
  });

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
    const meta = await createNote("Untitled", folder, "");
    openNote(meta.path);
    setRenaming(meta);
  };

  const handleTrash = async (paths: string[]) => {
    const targets = paths
      .map((path) => notes.find((note) => note.path === path))
      .filter((note): note is NoteMeta => note !== undefined);
    if (targets.length === 0) return;
    const activeWasTrashed = targets.some((note) => note.path === activePath);
    try {
      await Promise.all(targets.map((note) => trash(note.path)));
      clearSelection();
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

  const moveFolder = async (path: string, folder: string) => {
    const leaf = path.split("/").pop()!;
    const target = folder ? `${folder}/${leaf}` : leaf;
    if (target === path) return;
    const movingActive = activePath === path || activePath?.startsWith(`${path}/`);
    try {
      await renameFolder(path, target);
      if (movingActive && activePath) {
        openNote(`${target}${activePath.slice(path.length)}`);
      }
      notice(`Moved “${leaf}” to ${folder || "Root"}.`, {
        duration: 6000,
        action: {
          label: "Undo",
          run: async () => {
            await renameFolder(target, path);
            if (movingActive && activePath) openNote(activePath);
          },
        },
      });
    } catch {
      notice("Could not move the folder. Is that name already taken?", {
        variant: "danger",
      });
    }
  };

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
              {...getFolderDropHandlers("")}
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
                  dragHandlers={getNoteDragHandlers(note.path)}
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
                onCreateNote={() => void handleCreate(folder)}
                onRename={setRenaming}
                onDelete={(note) =>
                  void handleTrash(selectionFor(note.path))
                }
                onRenameFolder={() => setRenamingFolder(folder)}
                onDeleteFolder={() => void handleDeleteFolder(folder)}
                draggedPath={draggedPath}
                dragOverFolder={dragOverFolder}
                getNoteDragHandlers={getNoteDragHandlers}
                getFolderDragHandlers={getFolderDragHandlers}
                getFolderDropHandlers={getFolderDropHandlers}
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
        <aside className="hidden w-[var(--sidebar-width)] shrink-0 flex-col border-r border-border bg-surface md:flex">
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
            data-testid="mobile-sidebar"
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

      <RenameNoteDialog note={renaming} onClose={() => setRenaming(null)} activePath={activePath} />
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
  getNoteDragHandlers,
  getFolderDragHandlers,
  getFolderDropHandlers,
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
  getNoteDragHandlers: (path: string) => ItemDragHandlers;
  getFolderDragHandlers: (path: string) => ItemDragHandlers;
  getFolderDropHandlers: (folder: string) => FolderDropHandlers;
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
            {...getFolderDragHandlers(folder)}
            {...getFolderDropHandlers(folder)}
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
      <div
        className="ui-folder-reveal"
        data-collapsed={collapsed}
        aria-hidden={collapsed}
        inert={collapsed}
      >
        <div className="min-h-0 overflow-hidden">
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
                dragHandlers={getNoteDragHandlers(note.path)}
                hideFolder
              />
            ))}
          </ul>
        </div>
      </div>
    </section>
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
  dragHandlers,
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
  dragHandlers: ItemDragHandlers;
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
            onClick={onClick}
            onContextMenu={onContextMenu}
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
            {...dragHandlers}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-sm px-2 py-2 text-left text-sm transition-[color,background-color,box-shadow,transform] md:py-1.5",
              active
                ? "bg-accent-soft text-foreground shadow-[inset_2px_0_0_var(--accent)]"
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

