import { useEffect } from "react";
import { Outlet, useMatch, useNavigate } from "react-router";
import { useStore } from "zustand";
import { PanelLeft, Search, X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { ThemeProvider } from "./ThemeProvider";
import { CommandPalette } from "./CommandPalette";
import { SettingsDialog } from "./SettingsDialog";
import { InstallPrompt } from "../InstallPrompt";
import { Toaster } from "../components/ui/toast";
import { ConfirmHost } from "../components/ui/confirm";
import { TooltipProvider } from "../components/ui/tooltip";
import { MountHost } from "../components/MountHost";
import { Button } from "../components/ui/button";
import { setActiveNoteId, setNavigator } from "../core/navigation";
import { toggleRightPanel, workspaceStore } from "../core/workspace";
import { useUI } from "../store/ui";

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

  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={400}>
        <div className="flex h-dvh flex-col bg-background text-foreground">
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
        <Toaster />
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
        <PanelLeft size={16} />
      </Button>
      <span className="flex-1 truncate px-1 text-[13px] font-medium">
        {name ?? "Notable"}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Search"
        onClick={() => useUI.getState().setPaletteOpen(true)}
      >
        <Search size={16} />
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
        <span className="flex-1 text-[13px] font-medium">{panel.title}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close panel"
          onClick={() => toggleRightPanel(panel.id)}
        >
          <X size={14} />
        </Button>
      </div>
      <MountHost
        key={panel.id}
        mount={panel.mount}
        className="min-h-0 flex-1 overflow-y-auto"
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
