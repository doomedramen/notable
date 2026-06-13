import { ContextMenu as ContextPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import {
  menuContentClass,
  menuDangerItemClass,
  menuItemClass,
  menuSeparatorClass,
} from "./menu";

export const ContextMenu = ContextPrimitive.Root;
export const ContextMenuTrigger = ContextPrimitive.Trigger;

export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextPrimitive.Content>) {
  return (
    <ContextPrimitive.Portal>
      <ContextPrimitive.Content
        className={cn(menuContentClass, className)}
        {...props}
      />
    </ContextPrimitive.Portal>
  );
}

export function ContextMenuItem({
  className,
  danger = false,
  ...props
}: ComponentProps<typeof ContextPrimitive.Item> & { danger?: boolean }) {
  return (
    <ContextPrimitive.Item
      className={cn(danger ? menuDangerItemClass : menuItemClass, className)}
      {...props}
    />
  );
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextPrimitive.Separator>) {
  return (
    <ContextPrimitive.Separator
      className={cn(menuSeparatorClass, className)}
      {...props}
    />
  );
}
