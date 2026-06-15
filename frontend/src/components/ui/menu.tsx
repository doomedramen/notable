/* Shared class strings for Radix menu surfaces (dropdown + context menu)
   so both look identical. */

export const menuContentClass =
  "ui-popover z-50 min-w-44 rounded-md bg-background p-1 shadow-[var(--shadow-popover)]";

export const menuItemClass =
  "flex cursor-default items-center gap-1.5 rounded-sm px-2 py-1.5 text-sm text-foreground outline-none select-none transition-colors duration-100 " +
  "data-[highlighted]:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export const menuDangerItemClass =
  "flex cursor-default items-center gap-1.5 rounded-sm px-2 py-1.5 text-sm text-danger outline-none select-none transition-colors duration-100 " +
  "data-[highlighted]:bg-danger/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export const menuSeparatorClass = "my-1 h-px bg-border";

export const menuLabelClass = "px-2 py-1.5 text-xs font-medium text-faint select-none";
