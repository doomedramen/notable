import { useEffect } from "react";
import { Outlet, useMatch, useNavigate } from "react-router";
import { useStore } from "zustand";
import { X } from "lucide-react";
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

export function AppShell() {
  const navigate = useNavigate();
  const noteMatch = useMatch("/note/*");
  const activePath = noteMatch?.params["*"] ?? null;

  // Bridge router state into framework-agnostic core (plugins use it).
  useEffect(() => setNavigator(navigate), [navigate]);
  useEffect(() => {
    setActiveNoteId(activePath);
  }, [activePath]);

  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={400}>
        <div className="flex h-dvh flex-col bg-background text-foreground">
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="flex min-w-0 flex-1 flex-col">
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

/** Hosts the active plugin-registered right panel (backlinks etc.). */
function RightPanel() {
  const panels = useStore(workspaceStore, (s) => s.rightPanels);
  const activeId = useStore(workspaceStore, (s) => s.activeRightPanel);
  const panel = panels.find((p) => p.id === activeId);
  if (!panel) return null;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-surface">
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
