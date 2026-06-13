import { useEffect, useRef } from "react";
import { createStore, useStore } from "zustand";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import type { Disposable, ModalSpec } from "../../plugin-api";

/* Host-rendered modal dialog for plugin-mounted content
   (plugin API's ui.openModal). One open modal at a time. */

const modalStore = createStore<{ pending: ModalSpec | null }>(() => ({
  pending: null,
}));

export function openModal(modal: ModalSpec): Disposable {
  const prev = modalStore.getState().pending;
  if (prev) modalStore.setState({ pending: null });
  modalStore.setState({ pending: modal });
  return {
    dispose: () => {
      if (modalStore.getState().pending === modal) {
        modalStore.setState({ pending: null });
      }
    },
  };
}

export function ModalHost() {
  const pending = useStore(modalStore, (s) => s.pending);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pending || !containerRef.current) return;
    return pending.mount(containerRef.current);
  }, [pending]);

  const close = () => modalStore.setState({ pending: null });

  return (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className={pending?.className}>
        {pending?.title && <DialogTitle>{pending.title}</DialogTitle>}
        <div ref={containerRef} />
      </DialogContent>
    </Dialog>
  );
}
