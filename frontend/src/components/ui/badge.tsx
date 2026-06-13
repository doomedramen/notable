import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Small pill for inline metadata (plugin source, status, etc.). */
export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "rounded-sm bg-surface-hover px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-faint",
        className,
      )}
      {...props}
    />
  );
}
