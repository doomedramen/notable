import { Toaster as SonnerToaster, toast } from "sonner";
import type { CSSProperties } from "react";

/* Transient notifications, powered by sonner. `notice()` stays callable from
   anywhere (sync layer, plugin API's ui.notice) — not just React — and keeps
   its historical signature so existing call sites are untouched. */

export interface NoticeAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface NoticeOptions {
  duration?: number;
  variant?: "default" | "danger";
  action?: NoticeAction;
}

/** Show a transient notification. Safe to call from anywhere. */
export function notice(
  message: string,
  durationOrOptions: number | NoticeOptions = {},
): void {
  const opts =
    typeof durationOrOptions === "number"
      ? { duration: durationOrOptions }
      : durationOrOptions;
  const { duration = 4000, variant = "default", action } = opts;
  const emit = variant === "danger" ? toast.error : toast;
  emit(message, {
    // duration 0 historically meant "stay until dismissed".
    duration: duration === 0 ? Infinity : duration,
    action: action
      ? { label: action.label, onClick: () => void action.run() }
      : undefined,
  });
}

// Map sonner's surface variables onto the app's design tokens so toasts follow
// the active theme (light/dark and custom plugin themes) without extra wiring.
const toasterStyle = {
  "--normal-bg": "color-mix(in srgb, var(--background) 95%, transparent)",
  "--normal-text": "var(--foreground)",
  "--normal-border": "var(--border)",
  "--border-radius": "0.375rem",
} as CSSProperties;

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      closeButton
      gap={8}
      offset={{ bottom: "2.75rem" }}
      mobileOffset={{
        bottom: "calc(2.75rem + env(safe-area-inset-bottom))",
        left: "0.75rem",
        right: "0.75rem",
      }}
      style={toasterStyle}
      toastOptions={{
        classNames: {
          toast: "ui-popover !shadow-[var(--shadow-popover)] backdrop-blur-xl",
          description: "!text-muted",
          error: "!text-danger",
          actionButton:
            "!bg-transparent !rounded-sm !px-1.5 !py-0.5 !font-medium !text-accent hover:!bg-accent-soft",
          closeButton:
            "!bg-background !border-border !text-faint hover:!text-foreground",
        },
      }}
    />
  );
}
