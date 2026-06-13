import type { ReactNode } from "react";
import type { IconSource } from "../../plugin-api";
import { cn } from "../../lib/cn";
import { AppIcon } from "../AppIcon";

/** Centered icon + message for empty lists (sidebar, trash, tags, palette). */
export function EmptyState({
  icon,
  children,
  className,
}: {
  icon?: IconSource;
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
      {icon && <AppIcon icon={icon} size={28} strokeWidth={1.5} />}
      <p>{children}</p>
    </div>
  );
}
