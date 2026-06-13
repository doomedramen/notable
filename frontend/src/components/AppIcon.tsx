import {
  Check,
  ChevronDown,
  Ellipsis,
  ExternalLink,
  FileSearch,
  FileText,
  Folder,
  FolderPlus,
  Hash,
  Monitor,
  Moon,
  Palette,
  PanelLeft,
  PanelRight,
  Plus,
  Puzzle,
  RotateCcw,
  Search,
  Settings,
  Smile,
  Sun,
  Terminal,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useStore } from "zustand";
import type { AppIconSlot, IconSource } from "@/plugin-api";
import { iconsStore, resolveIcon } from "@/core/icons";
import { useUI } from "@/store/ui";
import { cn } from "@/lib/cn";

const fallbacks: Record<AppIconSlot, LucideIcon> = {
  add: Plus,
  appearance: Palette,
  check: Check,
  "chevron-down": ChevronDown,
  clear: X,
  close: X,
  command: Terminal,
  "external-link": ExternalLink,
  "file-search": FileSearch,
  folder: Folder,
  "folder-add": FolderPlus,
  icon: Smile,
  more: Ellipsis,
  note: FileText,
  panel: PanelRight,
  plugins: Puzzle,
  restore: RotateCcw,
  search: Search,
  settings: Settings,
  sidebar: PanelLeft,
  tag: Hash,
  "theme-dark": Moon,
  "theme-light": Sun,
  "theme-system": Monitor,
  trash: Trash2,
};

export function AppIcon({
  icon,
  fallback,
  size = 16,
  className,
  strokeWidth,
}: {
  icon: IconSource;
  fallback?: AppIconSlot;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  useStore(iconsStore, (state) => state.packs);
  useStore(iconsStore, (state) => state.themes);
  useUI((state) => state.appIconTheme);
  const resolved = resolveIcon(icon) ?? (fallback ? resolveIcon(fallback) : null);

  if (resolved?.definition.glyph) {
    return (
      <span
        aria-hidden
        className={cn("inline-flex shrink-0 items-center justify-center", className)}
        style={{ width: size, height: size, fontSize: size, lineHeight: 1 }}
      >
        {resolved.definition.glyph}
      </span>
    );
  }

  if (resolved?.definition.body) {
    return (
      <svg
        aria-hidden
        className={cn("shrink-0", className)}
        width={size}
        height={size}
        viewBox={resolved.definition.viewBox ?? "0 0 24 24"}
        fill="currentColor"
        focusable="false"
        dangerouslySetInnerHTML={{ __html: resolved.definition.body }}
      />
    );
  }

  const fallbackSlot = typeof icon === "string" ? icon : fallback;
  if (fallbackSlot) {
    const Fallback = fallbacks[fallbackSlot];
    return (
      <Fallback
        aria-hidden
        size={size}
        strokeWidth={strokeWidth}
        className={className}
      />
    );
  }

  return null;
}
