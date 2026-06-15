import { Dialog as DialogPrimitive } from "radix-ui";
import { forwardRef, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("ui-sheet-overlay fixed inset-0 z-30 bg-black/50", className)}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

export const SheetContent = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof DialogPrimitive.Content> & {
    title: string;
    description?: string;
  }
>(({ className, children, title, description, ...props }, ref) => (
  <DialogPrimitive.Content
    ref={ref}
    className={cn("ui-sheet-content fixed inset-y-0 left-0 z-40 focus:outline-none", className)}
    {...props}
  >
    <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
    <DialogPrimitive.Description className="sr-only">
      {description ?? title}
    </DialogPrimitive.Description>
    {children}
  </DialogPrimitive.Content>
));
SheetContent.displayName = "SheetContent";
