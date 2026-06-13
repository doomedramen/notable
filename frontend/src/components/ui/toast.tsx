import { createStore, useStore } from "zustand";
import { AppIcon } from "../AppIcon";

/* Toasts live in a vanilla store so non-React code (sync layer, plugin
   API's ui.notice) can raise them. */

export interface ToastItem {
  id: number;
  message: string;
  variant: "default" | "danger";
}

interface ToastState {
  toasts: ToastItem[];
  dismiss: (id: number) => void;
}

let nextId = 1;

export const toastStore = createStore<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Show a transient notification. Safe to call from anywhere. */
export function notice(
  message: string,
  opts: { duration?: number; variant?: "default" | "danger" } = {},
): void {
  const { duration = 4000, variant = "default" } = opts;
  const id = nextId++;
  toastStore.setState((s) => ({
    toasts: [...s.toasts, { id, message, variant }],
  }));
  if (duration > 0) {
    setTimeout(() => toastStore.getState().dismiss(id), duration);
  }
}

export function Toaster() {
  const toasts = useStore(toastStore, (s) => s.toasts);
  const dismiss = useStore(toastStore, (s) => s.dismiss);
  if (toasts.length === 0) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(2.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col gap-2 md:inset-x-auto md:right-4 md:w-80">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="ui-popover flex items-start gap-2 rounded-md bg-background px-3 py-2.5 text-sm shadow-[var(--shadow-popover)]"
          data-state="open"
        >
          <span
            className={
              t.variant === "danger" ? "flex-1 text-danger" : "flex-1 text-foreground"
            }
          >
            {t.message}
          </span>
          <button
            onClick={() => dismiss(t.id)}
            className="rounded-sm p-0.5 text-faint hover:text-foreground"
            aria-label="Dismiss"
          >
            <AppIcon icon="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
