import { createStore, useStore } from "zustand";
import { AppIcon } from "../AppIcon";

/* Toasts live in a vanilla store so non-React code (sync layer, plugin
   API's ui.notice) can raise them. */

export interface ToastItem {
  id: number;
  message: string;
  variant: "default" | "danger";
  action?: NoticeAction;
}

export interface NoticeAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface NoticeOptions {
  duration?: number;
  variant?: "default" | "danger";
  action?: NoticeAction;
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
  durationOrOptions: number | NoticeOptions = {},
): void {
  const opts =
    typeof durationOrOptions === "number"
      ? { duration: durationOrOptions }
      : durationOrOptions;
  const { duration = 4000, variant = "default" } = opts;
  const id = nextId++;
  toastStore.setState((s) => ({
    toasts: [...s.toasts, { id, message, variant, action: opts.action }],
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
          role={t.variant === "danger" ? "alert" : "status"}
          className="ui-popover flex items-start gap-2 rounded-md border border-border bg-background/95 px-3 py-2.5 text-sm shadow-[var(--shadow-popover)] backdrop-blur-xl"
          data-state="open"
        >
          <span
            className={
              t.variant === "danger"
                ? "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger"
                : "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
            }
            aria-hidden
          >
            <AppIcon icon={t.variant === "danger" ? "close" : "check"} size={10} />
          </span>
          <span
            className={
              t.variant === "danger" ? "flex-1 text-danger" : "flex-1 text-foreground"
            }
          >
            {t.message}
          </span>
          {t.action && (
            <button
              onClick={() => {
                dismiss(t.id);
                void t.action?.run();
              }}
              className="rounded-sm px-1.5 py-0.5 font-medium text-accent transition-colors hover:bg-accent-soft"
            >
              {t.action.label}
            </button>
          )}
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
