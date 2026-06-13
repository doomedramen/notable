import { useEffect, useRef, type TouchEvent } from "react";
import { Outlet, useMatch, useNavigate } from "react-router";
import { useStore } from "zustand";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { ThemeProvider } from "./ThemeProvider";
import { CommandPalette } from "./CommandPalette";
import { SettingsDialog } from "./SettingsDialog";
import { InstallPrompt } from "../InstallPrompt";
import { UpdatePrompt } from "./UpdatePrompt";
import { Toaster } from "../components/ui/toast";
import { ConfirmHost } from "../components/ui/confirm";
import { TooltipProvider } from "../components/ui/tooltip";
import { MountHost } from "../components/MountHost";
import { Button } from "../components/ui/button";
import { setActiveNoteId, setNavigator } from "../core/navigation";
import { toggleRightPanel, workspaceStore } from "../core/workspace";
import { useUI } from "../store/ui";
import { AppIcon } from "../components/AppIcon";
import { IconPicker } from "../components/IconPicker";

const isMobile = () => window.matchMedia("(max-width: 767px)").matches;

export function AppShell() {
  const navigate = useNavigate();
  const noteMatch = useMatch("/note/*");
  const activePath = noteMatch?.params["*"] ?? null;
  const sidebarOpen = useUI((s) => s.sidebarOpen);

  // Bridge router state into framework-agnostic core (plugins use it).
  useEffect(() => setNavigator(navigate), [navigate]);
  useEffect(() => {
    setActiveNoteId(activePath);
    // Mobile: navigating to a note closes the drawer to reveal it.
    if (activePath && isMobile() && useUI.getState().sidebarOpen) {
      useUI.getState().toggleSidebar();
    }
  }, [activePath]);

  // Mobile edge-swipe: drag in from the left edge to open the drawer,
  // swipe left anywhere to close it — matches native app conventions.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    if (!isMobile()) return;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || !isMobile()) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Ignore mostly-vertical drags (scrolling) and short flicks.
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const open = useUI.getState().sidebarOpen;
    if (dx > 0 && !open && start.x < 32) {
      useUI.getState().toggleSidebar();
    } else if (dx < 0 && open) {
      useUI.getState().toggleSidebar();
    }
  };

  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={400}>
        <div
          className="flex h-dvh flex-col bg-background text-foreground"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className="relative flex min-h-0 flex-1">
            {/* Mobile: backdrop behind the drawer */}
            {sidebarOpen && (
              <div
                className="fixed inset-0 z-30 bg-black/40 md:hidden"
                onClick={() => useUI.getState().toggleSidebar()}
                aria-hidden
              />
            )}
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
  const name = activePath?.split("/").pop()?.replace(/\.md$/, "");
  return (
    <header
      className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2 pt-[env(safe-area-inset-top)] md:hidden"
      data-testid="mobile-top-bar"
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open sidebar"
        onClick={() => useUI.getState().toggleSidebar()}
      >
        <AppIcon icon="sidebar" size={16} />
      </Button>
      <span className="flex-1 truncate px-1 text-sm font-medium">
        {name ?? "Notable"}
      </span>
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
    <aside className="fixed inset-y-0 right-0 z-40 flex w-80 max-w-[85vw] flex-col border-l border-border bg-surface md:static md:z-auto md:w-72">
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
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-sm text-faint select-none">
        Select a note or create one to start writing.
      </p>
    </div>
  );
}
