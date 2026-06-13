import { createStore } from "zustand";
import {
  CURRENT_PLUGIN_API_VERSION,
  type Disposable,
  type NotablePlugin,
  type PluginManifest,
} from "@/plugin-api";
import { createPluginAPI } from "./api";
import { notice } from "@/components/ui/toast";
import { selectTheme } from "./appearance";
import { selectIconTheme } from "./icons";
import { useUI } from "@/store/ui";

/* Loads runtime plugins from the server. A broken plugin must degrade to
   a toast + disabled state, never a white screen. */

export interface PluginInfo extends PluginManifest {
  source: "core" | "community";
  enabled: boolean;
  userManaged: boolean;
}

export interface CommunityPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  apiVersion: number;
  categories: string[];
  installed: boolean;
  enabled: boolean;
  activeVersion: string | null;
  updateAvailable: boolean;
  installable: boolean;
  compatible: boolean;
}

interface LoadedPlugin {
  manifest: PluginManifest;
  instance: NotablePlugin;
  disposables: Disposable[];
}

interface PluginState {
  /** All plugins known to the server (manifest + enabled flag). */
  available: readonly PluginInfo[];
  /** Ids currently loaded and running. */
  running: ReadonlySet<string>;
  /** Community plugins published by the configured registry. */
  store: readonly CommunityPlugin[];
  registryUrl: string | null;
  storeError: string | null;
}

export const pluginStore = createStore<PluginState>(() => ({
  available: [],
  running: new Set(),
  store: [],
  registryUrl: null,
  storeError: null,
}));

const loaded = new Map<string, LoadedPlugin>();
const loading = new Map<string, Promise<boolean>>();

export async function fetchPlugins(): Promise<PluginInfo[]> {
  try {
    const res = await fetch("/api/plugins");
    if (!res.ok) return [];
    const available = (await res.json()) as PluginInfo[];
    pluginStore.setState({ available });
    return available;
  } catch {
    return []; // offline — plugins just don't load this session
  }
}

export async function fetchPluginStore(): Promise<CommunityPlugin[]> {
  try {
    const res = await fetch("/api/plugins/store");
    if (!res.ok) throw new Error(await responseError(res));
    const data = (await res.json()) as {
      registryUrl: string;
      plugins: CommunityPlugin[];
    };
    pluginStore.setState({
      store: data.plugins,
      registryUrl: data.registryUrl,
      storeError: null,
    });
    return data.plugins;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load plugin registry";
    pluginStore.setState({ storeError: message });
    return [];
  }
}

/** Load every enabled plugin. Safe to retry after reconnecting. */
export async function loadEnabledPlugins(): Promise<void> {
  const available = await fetchPlugins();
  await Promise.all(
    available.filter((p) => p.enabled).map((p) => loadPlugin(p)),
  );
}

export async function loadPlugin(manifest: PluginManifest): Promise<boolean> {
  const pending = loading.get(manifest.id);
  if (pending) return pending;
  const task = loadPluginOnce(manifest);
  loading.set(manifest.id, task);
  try {
    return await task;
  } finally {
    if (loading.get(manifest.id) === task) loading.delete(manifest.id);
  }
}

async function loadPluginOnce(manifest: PluginManifest): Promise<boolean> {
  if (loaded.has(manifest.id)) return true;
  if ((manifest.apiVersion ?? 1) > CURRENT_PLUGIN_API_VERSION) {
    notice(`Plugin “${manifest.name}” requires a newer Notable version.`, {
      variant: "danger",
    });
    return false;
  }
  const entry = manifest.entry ?? "main.js";
  try {
    const entryPath = entry.split("/").map(encodeURIComponent).join("/");
    const url = `/api/plugins/${encodeURIComponent(manifest.id)}/${entryPath}?v=${encodeURIComponent(manifest.version)}`;
    const mod = (await import(/* @vite-ignore */ url)) as {
      default?: NotablePlugin;
    };
    const instance = mod.default;
    if (!instance || typeof instance.onload !== "function") {
      throw new Error("module must default-export { onload }");
    }
    const disposables: Disposable[] = [];
    const api = createPluginAPI(manifest, disposables);
    await instance.onload(api);
    loaded.set(manifest.id, { manifest, instance, disposables });
    pluginStore.setState((s) => ({
      running: new Set(s.running).add(manifest.id),
    }));
    return true;
  } catch (err) {
    console.error(`[plugins] "${manifest.id}" failed to load`, err);
    notice(`Plugin “${manifest.name}” failed to load — see console.`, {
      variant: "danger",
    });
    return false;
  }
}

export async function unloadPlugin(id: string): Promise<void> {
  await loading.get(id);
  const plugin = loaded.get(id);
  if (!plugin) return;
  loaded.delete(id);
  try {
    await plugin.instance.onunload?.();
  } catch (err) {
    console.error(`[plugins] "${id}" onunload threw`, err);
  }
  // Dispose everything the plugin registered, even what onunload forgot.
  for (const d of plugin.disposables.splice(0)) {
    try {
      d.dispose();
    } catch (err) {
      console.error(`[plugins] "${id}" disposable threw`, err);
    }
  }
  pluginStore.setState((s) => {
    const running = new Set(s.running);
    running.delete(id);
    return { running };
  });
}

/** Toggle a plugin: persists the flag and loads/unloads live. */
export async function setPluginEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  const res = await fetch(`/api/plugins/${encodeURIComponent(id)}/enabled`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(await responseError(res));
  pluginStore.setState((s) => ({
    available: s.available.map((p) => (p.id === id ? { ...p, enabled } : p)),
  }));
  if (enabled) {
    const manifest = pluginStore.getState().available.find((p) => p.id === id);
    if (manifest) await loadPlugin(manifest);
  } else {
    await unloadPlugin(id);
  }
}

export async function installCommunityPlugin(id: string): Promise<void> {
  const wasRunning = loaded.has(id) || loading.has(id);
  const selectedTheme = useUI.getState().customTheme;
  const selectedIconTheme = useUI.getState().appIconTheme;
  const restoreTheme =
    selectedTheme?.startsWith(`${id}:`) === true ? selectedTheme : null;
  const restoreIconTheme =
    selectedIconTheme?.startsWith(`${id}:`) === true ? selectedIconTheme : null;
  const res = await fetch(`/api/plugins/${encodeURIComponent(id)}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await responseError(res));

  if (wasRunning) await unloadPlugin(id);
  const [available] = await Promise.all([fetchPlugins(), fetchPluginStore()]);
  const installed = available.find((plugin) => plugin.id === id);
  if (installed?.enabled) {
    await loadPlugin(installed);
    if (restoreTheme) selectTheme(restoreTheme);
    if (restoreIconTheme) selectIconTheme(restoreIconTheme);
  }
}

export async function uninstallCommunityPlugin(id: string): Promise<void> {
  const res = await fetch(`/api/plugins/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await responseError(res));
  await unloadPlugin(id);
  await Promise.all([fetchPlugins(), fetchPluginStore()]);
}

async function responseError(response: Response): Promise<string> {
  const body = (await response.text()).trim();
  return body || `Plugin request failed (${response.status})`;
}
