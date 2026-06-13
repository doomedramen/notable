import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "../../lib/cn";

// lucide-react icon size convention used across the app:
//  - 14px: menu items, inline text, status indicators
//  - 16px: toolbar and button icons (size="icon" buttons below)
//  - 20px: page-header icons (e.g. TagView, TrashView)

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dangerSolid";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-foreground hover:opacity-90 active:opacity-80 font-medium",
  secondary:
    "bg-surface text-foreground border border-border hover:bg-surface-hover hover:border-border-strong",
  ghost: "text-muted hover:text-foreground hover:bg-surface-hover",
  // Subtle: icon/menu actions inline with other content (e.g. uninstall).
  danger: "text-danger hover:bg-danger/10",
  // Solid: the destructive confirm CTA in a dialog footer.
  dangerSolid:
    "bg-danger text-white hover:opacity-90 active:opacity-80 font-medium",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-sm gap-1.5",
  md: "h-8 px-3 text-sm gap-2",
  icon: "h-8 w-8 shrink-0",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-sm transition-[color,background-color,border-color,opacity,transform] select-none",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
