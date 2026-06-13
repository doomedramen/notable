import { createStore } from "zustand";
import type {
  AppIconSlot,
  Disposable,
  IconDefinition,
  IconPackSpec,
  IconPickerOptions,
  IconRef,
  IconSource,
  IconThemeSpec,
  PluginManifest,
} from "../plugin-api";
import { useUI } from "../store/ui";

export interface RegisteredIconPack extends Omit<IconPackSpec, "id"> {
  id: string;
  pluginId: string;
}

export interface RegisteredIconTheme extends Omit<IconThemeSpec, "id"> {
  id: string;
  pluginId: string;
}

interface PickerState {
  options: IconPickerOptions;
}

interface IconsState {
  packs: readonly RegisteredIconPack[];
  themes: readonly RegisteredIconTheme[];
  picker: PickerState | null;
}

export const iconsStore = createStore<IconsState>(() => ({
  packs: [],
  themes: [],
  picker: null,
}));

let pickerResolve:
  | ((value: IconRef | null | undefined) => void)
  | null = null;

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function registerIconPack(
  manifest: PluginManifest,
  pack: IconPackSpec,
): Disposable {
  validatePack(pack);
  const registered: RegisteredIconPack = {
    ...pack,
    id: namespaced(manifest.id, pack.id),
    pluginId: manifest.id,
  };
  iconsStore.setState((state) => ({
    packs: [...state.packs, registered],
  }));
  return {
    dispose() {
      iconsStore.setState((state) => ({
        packs: state.packs.filter((candidate) => candidate !== registered),
      }));
    },
  };
}

export function registerIconTheme(
  manifest: PluginManifest,
  theme: IconThemeSpec,
): Disposable {
  if (!ID_PATTERN.test(theme.id) || !theme.name.trim()) {
    throw new Error("icon theme id and name are required");
  }
  const registered: RegisteredIconTheme = {
    ...theme,
    id: namespaced(manifest.id, theme.id),
    pluginId: manifest.id,
    icons: Object.fromEntries(
      Object.entries(theme.icons).map(([slot, icon]) => [
        slot,
        icon ? namespaceRef(manifest.id, icon) : icon,
      ]),
    ),
  };
  iconsStore.setState((state) => ({
    themes: [...state.themes, registered],
  }));
  return {
    dispose() {
      iconsStore.setState((state) => ({
        themes: state.themes.filter((candidate) => candidate !== registered),
      }));
      if (useUI.getState().appIconTheme === registered.id) {
        useUI.getState().setAppIconTheme(null);
      }
    },
  };
}

export function resolveIcon(source: IconSource): {
  definition: IconDefinition;
  ref: IconRef;
} | null {
  const ref =
    typeof source === "string" ? resolveSlot(source) : source;
  if (!ref) return null;
  const pack = iconsStore
    .getState()
    .packs.find((candidate) => candidate.id === ref.packId);
  const definition = pack?.icons[ref.iconId];
  return definition ? { definition, ref } : null;
}

export function requestIconPick(
  options: IconPickerOptions = {},
): Promise<IconRef | null | undefined> {
  pickerResolve?.(undefined);
  iconsStore.setState({ picker: { options } });
  return new Promise((resolve) => {
    pickerResolve = resolve;
  });
}

export function finishIconPick(value: IconRef | null | undefined): void {
  if (value) rememberIcon(value);
  const resolve = pickerResolve;
  pickerResolve = null;
  iconsStore.setState({ picker: null });
  resolve?.(value);
}

export function selectIconTheme(id: string | null): void {
  if (
    id === null ||
    iconsStore.getState().themes.some((theme) => theme.id === id)
  ) {
    useUI.getState().setAppIconTheme(id);
  }
}

function resolveSlot(slot: AppIconSlot): IconRef | null {
  const selected = useUI.getState().appIconTheme;
  if (!selected) return null;
  return (
    iconsStore.getState().themes.find((theme) => theme.id === selected)?.icons[
      slot
    ] ?? null
  );
}

function rememberIcon(icon: IconRef): void {
  const state = useUI.getState();
  state.setRecentIcons(
    [
      icon,
      ...state.recentIcons.filter(
        (candidate) =>
          candidate.packId !== icon.packId || candidate.iconId !== icon.iconId,
      ),
    ].slice(0, 24),
  );
}

function validatePack(pack: IconPackSpec): void {
  if (!ID_PATTERN.test(pack.id) || !pack.name.trim()) {
    throw new Error("icon pack id and name are required");
  }
  for (const [id, icon] of Object.entries(pack.icons)) {
    if (!id || (!icon.body && !icon.glyph)) {
      throw new Error(`invalid icon definition "${id}"`);
    }
  }
}

function namespaceRef(pluginId: string, icon: IconRef): IconRef {
  return {
    ...icon,
    packId: icon.packId.includes(":")
      ? icon.packId
      : namespaced(pluginId, icon.packId),
  };
}

function namespaced(pluginId: string, id: string): string {
  return `${pluginId}:${id}`;
}
