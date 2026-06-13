import { useStore } from "zustand";
import { useSyncStatus } from "../store/sync-status";
import { workspaceStore } from "../core/workspace";
import { MountHost } from "../components/MountHost";
import { useUI, type ThemePref } from "../store/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Button } from "../components/ui/button";
import { Tooltip } from "../components/ui/tooltip";
import { cn } from "../lib/cn";
import { AppIcon } from "../components/AppIcon";

const statusConfig = {
  synced: { label: "Synced", dot: "bg-success" },
  connecting: { label: "Connecting…", dot: "bg-warning animate-pulse" },
  offline: { label: "Offline — changes saved locally", dot: "bg-warning" },
} as const;

const themeIcons: Record<ThemePref, "theme-light" | "theme-dark" | "theme-system"> = {
  light: "theme-light",
  dark: "theme-dark",
  system: "theme-system",
};

export function StatusBar() {
  const status = useSyncStatus((s) => s.status);
  const dirty = useSyncStatus((s) => s.dirty);

  return (
    <footer className="flex h-[calc(1.75rem+env(safe-area-inset-bottom))] shrink-0 items-center gap-3 border-t border-border bg-surface px-3 pb-[env(safe-area-inset-bottom)] text-xs text-muted">
      {status !== null && (
        <span className="flex items-center gap-1.5">
          <span
            className={cn("h-1.5 w-1.5 rounded-full", statusConfig[status].dot)}
          />
          {statusConfig[status].label}
        </span>
      )}
      {dirty > 0 && (
        <span className="text-warning">
          {dirty} note{dirty > 1 ? "s" : ""} pending sync
        </span>
      )}
      <span className="flex-1" />
      <StatusBarItems />
      <ThemeToggle />
    </footer>
  );
}

/** Plugin-registered status bar items (right-aligned). */
function StatusBarItems() {
  const items = useStore(workspaceStore, (s) => s.statusBarItems);
  return (
    <>
      {items.map((item) => (
        <MountHost
          key={item.id}
          mount={item.mount}
          className="flex items-center"
        />
      ))}
    </>
  );
}

function ThemeToggle() {
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const icon = themeIcons[theme];

  return (
    <DropdownMenu>
      <Tooltip label="Theme">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-5 w-5" aria-label="Theme">
            <AppIcon icon={icon} size={14} />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" side="top">
        {(["light", "dark", "system"] as const).map((t) => {
          const itemIcon = themeIcons[t];
          return (
            <DropdownMenuItem key={t} onSelect={() => setTheme(t)}>
              <AppIcon icon={itemIcon} size={14} className="text-muted" />
              <span className="capitalize">{t}</span>
              {theme === t && <span className="ml-auto text-accent">✓</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
