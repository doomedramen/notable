import { useRef, useState, type ChangeEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AppIcon } from "@/components/AppIcon";
import { useUI } from "@/store/ui";
import { syncNotesList, useNotesStore } from "@/store/notes-store";
import { pendingCreatePaths } from "@/store/notes";
import {
  previewDirectoryFiles,
  previewDirectoryPicker,
  previewZip,
  resolvePreviewConflicts,
  type ImportPreview,
} from "@/core/vault-import";

interface ImportResult {
  imported: number;
  queued: number;
  skipped: number;
  renamed: number;
}

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

export function ImportVaultDialog() {
  const open = useUI((state) => state.importOpen);
  const setOpen = useUI((state) => state.setImportOpen);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPreview(null);
    setResult(null);
    setStatus(null);
    setError(null);
    if (folderInput.current) folderInput.current.value = "";
    if (zipInput.current) zipInput.current.value = "";
  };

  const close = (next: boolean) => {
    if (!next && status) return;
    if (!next && !status) reset();
    setOpen(next);
  };

  const prepare = async (source: Promise<ImportPreview>) => {
    setStatus("Reading import…");
    setError(null);
    setResult(null);
    try {
      const parsed = await source;
      await useNotesStore.getState().refresh();
      const existing = useNotesStore.getState().notes.map((note) => note.path);
      setPreview(resolvePreviewConflicts(parsed, existing));
    } catch (cause) {
      if ((cause as DOMException)?.name !== "AbortError") {
        setError(cause instanceof Error ? cause.message : "Could not read the import.");
      }
    } finally {
      setStatus(null);
    }
  };

  const chooseFolder = () => {
    if (window.showDirectoryPicker) {
      void prepare(previewDirectoryPicker());
    } else {
      folderInput.current?.click();
    }
  };

  const onFolderFiles = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      void prepare(previewDirectoryFiles(event.target.files));
    }
  };

  const onZipFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void prepare(previewZip(file));
  };

  const importPreview = async () => {
    if (!preview || preview.entries.length === 0) return;
    setStatus("Saving import locally…");
    setError(null);
    try {
      const staged = await useNotesStore.getState().importEntries(preview.entries, preview.folders);
      setStatus("Syncing with the vault…");
      const flush = await syncNotesList();
      const finalPaths = staged.notes.map((note) => {
        return flush.pathChanges.find((change) => change.from === note.path)?.to ?? note.path;
      });
      const queued = await pendingCreatePaths(finalPaths);
      setResult({
        imported: staged.notes.length,
        queued: queued.size,
        skipped: preview.skipped.length,
        renamed: preview.conflicts.length + staged.conflicts.length + flush.pathChanges.length,
      });
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not stage the import.");
    } finally {
      setStatus(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[min(38rem,calc(100dvh-2rem))] overflow-y-auto">
        <DialogTitle>Import into vault</DialogTitle>
        <DialogDescription>
          Import a folder or ZIP of Markdown files. The selected outer folder is preserved, and
          existing notes are never overwritten.
        </DialogDescription>

        <input
          ref={folderInput}
          type="file"
          multiple
          className="hidden"
          onChange={onFolderFiles}
          {...({ webkitdirectory: "" } as Record<string, string>)}
        />
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={onZipFile}
        />

        {!preview && !result && (
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Button
              className="h-auto min-h-20 flex-col gap-1.5 px-4 py-3"
              onClick={chooseFolder}
              disabled={status !== null}
            >
              <AppIcon icon="folder" size={20} className="text-accent" />
              <span>Choose folder</span>
              <span className="text-xs font-normal text-faint">Preserve its folder tree</span>
            </Button>
            <Button
              className="h-auto min-h-20 flex-col gap-1.5 px-4 py-3"
              onClick={() => zipInput.current?.click()}
              disabled={status !== null}
            >
              <AppIcon icon="note" size={20} className="text-accent" />
              <span>Choose ZIP</span>
              <span className="text-xs font-normal text-faint">Useful on mobile browsers</span>
            </Button>
          </div>
        )}

        {status && (
          <p className="mt-5 rounded-md bg-surface px-3 py-3 text-sm text-muted">{status}</p>
        )}

        {error && (
          <p className="mt-4 rounded-md bg-danger/10 px-3 py-2.5 text-sm text-danger">{error}</p>
        )}

        {preview && (
          <>
            <div className="mt-5 rounded-md border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <AppIcon icon="folder" size={16} className="text-accent" />
                <strong className="truncate text-sm">{preview.rootName}</strong>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Markdown notes</dt>
                <dd className="text-right">{preview.entries.length}</dd>
                <dt className="text-muted">Folders</dt>
                <dd className="text-right">{preview.folders.length}</dd>
                <dt className="text-muted">Content size</dt>
                <dd className="text-right">{bytes(preview.totalBytes)}</dd>
                <dt className="text-muted">Renamed conflicts</dt>
                <dd className="text-right">{preview.conflicts.length}</dd>
                <dt className="text-muted">Skipped files</dt>
                <dd className="text-right">{preview.skipped.length}</dd>
              </dl>
            </div>

            {preview.conflicts.length > 0 && (
              <div className="mt-3 text-xs text-muted">
                <p className="font-medium text-foreground">Conflicting notes will be renamed</p>
                {preview.conflicts.slice(0, 3).map((conflict) => (
                  <p key={`${conflict.from}-${conflict.to}`} className="mt-1 truncate">
                    {conflict.from} → {conflict.to}
                  </p>
                ))}
              </div>
            )}

            {preview.skipped.length > 0 && (
              <div className="mt-3 text-xs text-muted">
                <p className="font-medium text-foreground">Skipped files</p>
                {preview.skipped.slice(0, 3).map((item, index) => (
                  <p key={`${item.path}-${index}`} className="mt-1 truncate">
                    {item.path}: {item.reason.replaceAll("-", " ")}
                  </p>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button onClick={reset}>Choose another</Button>
              <Button
                variant="primary"
                onClick={() => void importPreview()}
                disabled={preview.entries.length === 0 || status !== null}
              >
                Import {preview.entries.length} notes
              </Button>
            </DialogFooter>
          </>
        )}

        {result && (
          <>
            <div className="mt-5 rounded-md border border-border bg-surface p-4 text-sm">
              <p className="font-medium">
                Imported {result.imported} note
                {result.imported === 1 ? "" : "s"}.
              </p>
              <p className="mt-1 text-muted">
                {result.queued > 0
                  ? `${result.queued} will sync when the server is reachable.`
                  : "Everything is synced to the vault."}
              </p>
              {(result.renamed > 0 || result.skipped > 0) && (
                <p className="mt-2 text-xs text-faint">
                  {result.renamed} renamed, {result.skipped} skipped.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="primary" onClick={() => close(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
