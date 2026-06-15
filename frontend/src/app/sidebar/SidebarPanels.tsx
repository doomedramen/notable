import { useState } from "react";
import { useStore } from "zustand";
import { workspaceStore } from "@/core/workspace";
import { MountHost } from "@/components/MountHost";
import { AppIcon } from "@/components/AppIcon";
import { cn } from "@/lib/cn";

/** Plugin-registered sidebar panels, collapsible below the note list. */
export function SidebarPanels() {
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
                className={cn("transition-transform duration-200", !open && "-rotate-90")}
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
