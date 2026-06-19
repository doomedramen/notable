import { useLayoutEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { useSyncStatus, type SyncStatus } from "@/store/sync-status";
import { dirtyNotes } from "@/sync/dirty";
import { workspaceStore } from "@/core/workspace";
import { MountHost } from "@/components/MountHost";
import type { StatusBarItemSpec, StatusBarTextItemSpec } from "@/plugin-api";
import { useUI, type ThemePref } from "@/store/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { AppIcon } from "@/components/AppIcon";

interface VisualConfig {
  dot: string;
  label: string;
  detail: string;
}

function getVisualConfig(status: SyncStatus | null, dirty: number): VisualConfig {
  if (status === "synced" && dirty === 0) {
    return { dot: "bg-success", label: "Synced", detail: "All changes are synced." };
  }
  if (status === "synced" && dirty > 0) {
    return {
      dot: "bg-warning",
      label: `${dirty} pending`,
      detail: `${dirty} note${dirty === 1 ? "" : "s"} waiting to sync.`,
    };
  }
  if (status === "connecting") {
    return {
      dot: "bg-warning animate-pulse",
      label: "Connecting",
      detail: "Connecting to the sync server.",
    };
  }
  if (status === "offline") {
    return {
      dot: "bg-danger",
      label: dirty > 0 ? `Offline · ${dirty} pending` : "Offline",
      detail: "Changes are saved locally until the server is reachable.",
    };
  }
  // status === null
  if (dirty > 0) {
    return {
      dot: "bg-danger",
      label: `${dirty} pending`,
      detail: `${dirty} note${dirty === 1 ? "" : "s"} have unsent changes.`,
    };
  }
  return { dot: "bg-success", label: "Synced", detail: "All changes are synced." };
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5000) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

const themeIcons: Record<ThemePref, "theme-light" | "theme-dark" | "theme-system"> = {
  light: "theme-light",
  dark: "theme-dark",
  system: "theme-system",
};

export function StatusBar() {
  const status = useSyncStatus((s) => s.status);
  const dirty = useSyncStatus((s) => s.dirty);

  return (
    <footer className="m-0 flex h-[calc(1.75rem+env(safe-area-inset-bottom))] shrink-0 flex-col border-t border-border bg-surface p-0 pb-[env(safe-area-inset-bottom)] text-xs text-muted">
      <div className="flex h-7 min-w-0 items-center gap-2 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
        <SyncIndicator status={status} dirty={dirty} />
        <StatusBarItems />
        <ThemeToggle />
      </div>
    </footer>
  );
}

function SyncIndicator({
  status,
  dirty,
}: {
  status: SyncStatus | null;
  dirty: number;
}) {
  const lastSynced = useSyncStatus((s) => s.lastSynced);
  const config = getVisualConfig(status, dirty);
  const notes = dirty > 0 ? dirtyNotes() : [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-testid="sync-indicator"
          aria-label="Sync status"
          className="flex min-w-0 shrink items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs transition-colors hover:text-accent"
        >
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", config.dot)} />
          <span className="truncate">{config.label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        <div className="p-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", config.dot)} />
            <span className="text-xs font-medium">{config.detail}</span>
          </div>
          {lastSynced != null && (
            <div className="text-xs text-muted">Last synced: {relativeTime(lastSynced)}</div>
          )}
          {notes.length > 0 && (
            <div className="mt-2">
              <div className="mb-1 text-xs font-medium">Pending notes:</div>
              <div className="max-h-32 space-y-0.5 overflow-y-auto">
                {notes.map((note) => (
                  <div key={note} className="truncate text-xs text-muted">
                    {note}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function isTextItem(item: StatusBarItemSpec): item is StatusBarTextItemSpec {
  return typeof item.text === "string";
}

/** Plugin status text stays inline until its host area becomes too narrow. */
function StatusBarItems() {
  const items = useStore(workspaceStore, (s) => s.statusBarItems);
  const textItems = items.filter(isTextItem);
  const legacyItems = items.filter((item) => !isTextItem(item));

  return (
    <div className="flex min-w-5 flex-1 items-center justify-end gap-2 overflow-hidden">
      {legacyItems.map((item) => (
        <MountHost key={item.id} mount={item.mount} className="flex shrink-0 items-center" />
      ))}
      <ResponsiveStatusItems items={textItems} />
    </div>
  );
}

function ResponsiveStatusItems({ items }: { items: StatusBarTextItemSpec[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [overflowed, setOverflowed] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const list = listRef.current;
    if (!container || !list || items.length === 0) {
      setOverflowed(false);
      return;
    }

    const measure = () => {
      setOverflowed(list.scrollWidth > container.clientWidth + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(list);
    measure();
    return () => observer.disconnect();
  }, [items.length]);

  if (items.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="relative flex min-w-5 flex-1 items-center justify-end overflow-hidden"
    >
      <div
        ref={listRef}
        data-testid="status-bar-inline-items"
        aria-hidden={overflowed || undefined}
        className={cn(
          "flex shrink-0 items-center gap-2 whitespace-nowrap",
          overflowed && "invisible absolute right-0 pointer-events-none",
        )}
      >
        {items.map((item) => (
          <InlineStatusItem key={item.id} item={item} />
        ))}
      </div>
      {overflowed && <StatusItemsMenu items={items} />}
    </div>
  );
}

function InlineStatusItem({ item }: { item: StatusBarTextItemSpec }) {
  const content = item.onSelect ? (
    <button
      type="button"
      onClick={item.onSelect}
      aria-label={item.tooltip ?? item.text}
      className="inline-flex h-5 items-center gap-1 text-muted tabular-nums transition-colors hover:text-accent"
    >
      {item.icon && <AppIcon icon={item.icon} size={13} />}
      {item.text}
    </button>
  ) : (
    <span className="inline-flex items-center gap-1 tabular-nums">
      {item.icon && <AppIcon icon={item.icon} size={13} />}
      {item.text}
    </span>
  );

  return item.tooltip ? <Tooltip label={item.tooltip}>{content}</Tooltip> : content;
}

function StatusItemsMenu({ items }: { items: StatusBarTextItemSpec[] }) {
  return (
    <DropdownMenu>
      <Tooltip label="Plugin status">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            aria-label="Show plugin status"
            data-testid="status-bar-overflow"
          >
            <AppIcon icon="more" size={14} />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" side="top" className="max-w-[calc(100vw-1rem)]">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            title={item.tooltip}
            onSelect={(event) => {
              if (item.onSelect) item.onSelect();
              else event.preventDefault();
            }}
          >
            {item.icon && <AppIcon icon={item.icon} size={14} className="text-muted" />}
            <span className="whitespace-nowrap tabular-nums">{item.text}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" aria-label="Theme">
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
