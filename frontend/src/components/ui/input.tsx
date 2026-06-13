import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "../../lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-sm border border-border bg-background px-2.5 text-sm text-foreground",
        "transition-[border-color,box-shadow,opacity]",
        "placeholder:text-faint",
        "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
