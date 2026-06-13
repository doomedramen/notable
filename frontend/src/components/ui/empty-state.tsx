import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

/** Centered icon + message for empty lists (sidebar, trash, tags, palette). */
export function EmptyState({
  icon: Icon,
  children,
  className,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 px-3 py-8 text-center text-sm text-faint",
        className,
      )}
    >
      {Icon && <Icon size={28} strokeWidth={1.5} />}
      <p>{children}</p>
    </div>
  );
}
