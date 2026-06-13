import { useEffect, useMemo, useRef } from "react";
import { Outlet, useMatch, useNavigate } from "react-router";
import { useStore } from "zustand";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { ThemeProvider } from "./ThemeProvider";
import { CommandPalette } from "./CommandPalette";
import { SettingsDialog } from "./SettingsDialog";
import { InstallPrompt } from "@/InstallPrompt";
import { UpdatePrompt } from "./UpdatePrompt";
import { Toaster } from "@/components/ui/toast";
import { ConfirmHost } from "@/components/ui/confirm";
import { ModalHost } from "@/components/ui/modal";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MountHost } from "@/components/MountHost";
import { Button } from "@/components/ui/button";
import { openNote, setActiveNoteId, setNavigator } from "@/core/navigation";
import { toggleRightPanel, workspaceStore } from "@/core/workspace";
import { useUI } from "@/store/ui";
import { AppIcon } from "@/components/AppIcon";
import { IconPicker } from "@/components/IconPicker";
import { useNotesStore } from "@/store/notes-store";

export function AppShell() {
  return <AppShellInner />;
}

function AppShellInner() {
  const navigate = useNavigate();
  const noteMatch = useMatch("/note/*");
  const activePath = noteMatch?.params["*"] ?? null;
  const setDrawerOpen = useUI((state) => state.setMobileSidebarOpen);
  const previousActivePath = useRef(activePath);

  // Bridge router state into framework-agnostic core (plugins use it).
  useEffect(() => setNavigator(navigate), [navigate]);
  useEffect(() => {
    setActiveNoteId(activePath);
    if (activePath) useUI.getState().recordRecentNote(activePath);
    // Mobile: navigating to a note closes the drawer to reveal it. Only do
    // this when the active note actually changed — not whenever the drawer
    // is opened while a note is already active.
    if (
      activePath &&
      activePath !== previousActivePath.current &&
      useUI.getState().mobileSidebarOpen
    ) {
      setDrawerOpen(false);
    }
    previousActivePath.current = activePath;
  }, [activePath, setDrawerOpen]);

  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={400}>
        <div
          className="flex h-dvh min-h-0 flex-col bg-background text-foreground"
        >
          <div className="relative flex min-h-0 flex-1">
            <Sidebar />
            <main className="flex min-w-0 flex-1 flex-col">
              <MobileTopBar activePath={activePath} />
              <Outlet />
            </main>
            <RightPanel />
          </div>
          <StatusBar />
        </div>
        <CommandPalette />
        <SettingsDialog />
        <ConfirmHost />
        <ModalHost />
        <InstallPrompt />
        <UpdatePrompt />
        <Toaster />
        <IconPicker />
      </TooltipProvider>
    </ThemeProvider>
  );
}

/** Small-screen header: drawer toggle, current note, search. */
function MobileTopBar({ activePath }: { activePath: string | null }) {
  return (
    <header
      className="flex h-[calc(2.75rem+env(safe-area-inset-top))] shrink-0 items-center gap-1 border-b border-border px-2 pt-[env(safe-area-inset-top)] md:hidden"
      data-testid="mobile-top-bar"
      aria-label={activePath ? "Note navigation" : "App navigation"}
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open sidebar"
        onClick={() => useUI.getState().setMobileSidebarOpen(true)}
      >
        <AppIcon icon="sidebar" size={16} />
      </Button>
      <span className="flex-1" aria-hidden />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Search"
        onClick={() => useUI.getState().setPaletteOpen(true)}
      >
        <AppIcon icon="search" size={16} />
      </Button>
    </header>
  );
}

/** Hosts the active plugin-registered right panel (backlinks etc.). */
function RightPanel() {
  const panels = useStore(workspaceStore, (s) => s.rightPanels);
  const activeId = useStore(workspaceStore, (s) => s.activeRightPanel);
  const panel = panels.find((p) => p.id === activeId);
  if (!panel) return null;

  return (
    <aside className="ui-right-panel fixed inset-y-0 right-0 z-40 flex w-80 max-w-[85vw] flex-col border-l border-border bg-surface/95 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:static md:z-auto md:w-72 md:bg-surface md:pt-0 md:pb-0 md:backdrop-blur-none">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        {panel.icon && <AppIcon icon={panel.icon} size={14} className="text-faint" />}
        <span className="flex-1 text-sm font-medium">{panel.title}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close panel"
          onClick={() => toggleRightPanel(panel.id)}
        >
          <AppIcon icon="close" size={14} />
        </Button>
      </div>
      <MountHost
        key={panel.id}
        mount={panel.mount}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      />
    </aside>
  );
}

export function EmptyState() {
  const notes = useNotesStore((state) => state.notes);
  const loaded = useNotesStore((state) => state.loaded);
  const recentNotePaths = useUI((state) => state.recentNotePaths);
  const hasNotes = loaded && notes.length > 0;
  const recentNotes = useMemo(() => {
    const byPath = new Map(notes.map((note) => [note.path, note]));
    const explicit = recentNotePaths
      .map((path) => byPath.get(path))
      .filter((note): note is (typeof notes)[number] => note !== undefined);
    const fallback = [...notes]
      .filter((note) => !recentNotePaths.includes(note.path))
      .sort((a, b) => b.modified - a.modified);
    return [...explicit, ...fallback].slice(0, 4);
  }, [notes, recentNotePaths]);

  return (
    <div className="ui-view flex flex-1 items-center justify-center overflow-y-auto px-5 py-10">
      <section className="w-full max-w-md text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <AppIcon icon="note" size={23} strokeWidth={1.7} />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          {hasNotes ? "Pick up where you left off" : "Create your first note"}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          {hasNotes
            ? "Open a note from the sidebar, find one by content, or start something new."
            : "Notable keeps your writing in plain Markdown files that stay yours."}
        </p>
        <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
          <Button
            variant="primary"
            className="w-full sm:w-auto"
            onClick={() =>
              void useNotesStore
                .getState()
                .create("Untitled", "", "")
                .then((meta) => openNote(meta.path))
            }
          >
            <AppIcon icon="add" size={15} />
            New note
          </Button>
          <Button
            className="w-full sm:w-auto"
            onClick={() => useUI.getState().setPaletteOpen(true)}
          >
            <AppIcon icon="search" size={15} />
            Find a note
          </Button>
        </div>

        {hasNotes && recentNotes.length > 0 && (
          <div className="mt-9 border-t border-border pt-4 text-left">
            <p className="px-2 text-xs font-medium tracking-wide text-faint">
              Recently opened
            </p>
            <div className="mt-1 space-y-0.5">
              {recentNotes.map((note, index) => (
                <button
                  key={note.path}
                  type="button"
                  onClick={() => openNote(note.path)}
                  className="group flex w-full items-center gap-2 rounded-md px-2.5 py-2.5 text-left text-sm text-muted transition-[color,background-color,transform] hover:bg-surface-hover hover:text-foreground"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-surface text-faint transition-colors group-hover:bg-background group-hover:text-accent">
                    <AppIcon icon="note" size={14} />
                  </span>
                  <span className="truncate">{note.name}</span>
                  {index === 0 && (
                    <span className="ml-auto shrink-0 text-xs text-faint">
                      Continue
                    </span>
                  )}
                  {note.folder && (
                    <span className={index === 0 ? "max-w-[32%] truncate text-xs text-faint" : "ml-auto max-w-[40%] truncate text-xs text-faint"}>
                      {note.folder}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
