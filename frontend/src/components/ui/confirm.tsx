import { createStore, useStore } from "zustand";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "./dialog";
import { triggerFeedback } from "../../core/feedback";

/* Promise-based confirm dialog, callable from outside React
   (plugin API's ui.confirm). One pending confirm at a time. */

interface ConfirmRequest {
  message: string;
  resolve: (ok: boolean) => void;
}

const confirmStore = createStore<{ pending: ConfirmRequest | null }>(() => ({
  pending: null,
}));

export function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const prev = confirmStore.getState().pending;
    prev?.resolve(false); // a newer request supersedes an unanswered one
    confirmStore.setState({ pending: { message, resolve } });
  });
}

export function ConfirmHost() {
  const pending = useStore(confirmStore, (s) => s.pending);

  const answer = (ok: boolean) => {
    pending?.resolve(ok);
    confirmStore.setState({ pending: null });
  };

  return (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && answer(false)}>
      <DialogContent showClose={false}>
        <DialogTitle>Are you sure?</DialogTitle>
        <DialogDescription>{pending?.message}</DialogDescription>
        <DialogFooter>
          <Button onClick={() => answer(false)}>Cancel</Button>
          <Button
            variant="dangerSolid"
            onPointerDown={(event) => {
              if (event.pointerType === "touch") triggerFeedback("warning");
            }}
            onClick={() => answer(true)}
            autoFocus
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
