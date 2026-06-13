import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import { iconsStore, finishIconPick } from "@/core/icons";
import { useUI } from "@/store/ui";
import type { IconRef } from "@/plugin-api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { AppIcon } from "./AppIcon";

const RESULT_LIMIT = 120;
const GRID_COLUMNS = 8;

export function IconPicker() {
  const picker = useStore(iconsStore, (state) => state.picker);
  const packs = useStore(iconsStore, (state) => state.packs);
  const recent = useUI((state) => state.recentIcons);
  const [query, setQuery] = useState("");
  const [packId, setPackId] = useState("all");

  useEffect(() => {
    if (picker) {
      setQuery("");
      setPackId("all");
    }
  }, [picker]);

  const choices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items: { ref: IconRef; label: string }[] = [];
    for (const pack of packs) {
      if (packId !== "all" && pack.id !== packId) continue;
      for (const [iconId, icon] of Object.entries(pack.icons)) {
        const haystack = `${iconId} ${(icon.keywords ?? []).join(" ")}`.toLowerCase();
        if (needle && !haystack.includes(needle)) continue;
        items.push({
          ref: { packId: pack.id, iconId },
          label: `${pack.name}: ${iconId}`,
        });
        if (items.length >= RESULT_LIMIT) return items;
      }
    }
    return items;
  }, [packs, packId, query]);

  if (!picker) return null;

  const focusChoice = (index: number) => {
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      "[data-icon-choice]",
    );
    buttons[index]?.focus();
  };

  const onChoiceKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -GRID_COLUMNS,
      ArrowDown: GRID_COLUMNS,
    };
    const delta = moves[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    focusChoice(Math.max(0, Math.min(choices.length - 1, index + delta)));
  };

  const validRecent = recent.filter((icon) =>
    packs.some(
      (pack) => pack.id === icon.packId && pack.icons[icon.iconId] !== undefined,
    ),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && finishIconPick(undefined)}>
      <DialogContent className="flex max-h-[80dvh] max-w-xl flex-col">
        <DialogTitle>{picker.options.title ?? "Choose icon"}</DialogTitle>
        <DialogDescription>
          Search installed icon packs. Results are limited to {RESULT_LIMIT}.
        </DialogDescription>
        <div className="mt-3 flex gap-2">
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && choices.length > 0) {
                event.preventDefault();
                focusChoice(0);
              }
            }}
            placeholder="Search icons"
            className="h-8 min-w-0 flex-1 rounded-sm border border-border bg-background px-2.5 text-sm outline-none focus:border-accent"
          />
          <select
            value={packId}
            onChange={(event) => setPackId(event.target.value)}
            aria-label="Icon pack"
            className="h-8 rounded-sm border border-border bg-background px-2 text-sm"
          >
            <option value="all">All packs</option>
            {packs.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.name}
              </option>
            ))}
          </select>
        </div>

        {!query && packId === "all" && validRecent.length > 0 && (
          <section className="mt-4">
            <h3 className="text-xs font-medium text-muted">Recent</h3>
            <div className="mt-2 flex flex-wrap gap-1">
              {validRecent.map((icon) => (
                <button
                  key={`${icon.packId}:${icon.iconId}`}
                  onClick={() => finishIconPick(icon)}
                  className="flex h-9 w-9 items-center justify-center rounded-sm text-muted hover:bg-surface-hover hover:text-foreground"
                  title={icon.iconId}
                >
                  <AppIcon icon={icon} size={20} />
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {choices.length === 0 ? (
            <p className="py-8 text-center text-sm text-faint">
              No matching icons.
            </p>
          ) : (
            <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
              {choices.map((choice, index) => (
                <button
                  key={`${choice.ref.packId}:${choice.ref.iconId}`}
                  data-icon-choice
                  onClick={() => finishIconPick(choice.ref)}
                  onKeyDown={(event) => onChoiceKeyDown(event, index)}
                  className="flex aspect-square items-center justify-center rounded-sm text-muted hover:bg-surface-hover hover:text-foreground focus:bg-accent-soft focus:text-accent focus:outline-none"
                  aria-label={choice.label}
                  title={choice.label}
                >
                  <AppIcon icon={choice.ref} size={22} />
                </button>
              ))}
            </div>
          )}
        </div>

        {picker.options.allowClear !== false && (
          <div className="mt-3 flex justify-end border-t border-border pt-3">
            <Button onClick={() => finishIconPick(null)}>Clear icon</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
