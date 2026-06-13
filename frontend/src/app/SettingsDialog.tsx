import { useEffect, useState } from "react";
import { useStore } from "zustand";
import {
  ExternalLink,
  Monitor,
  Moon,
  Palette,
  Puzzle,
  Search,
  Sun,
  Trash2,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Switch } from "../components/ui/switch";
import { Button } from "../components/ui/button";
import { MountHost } from "../components/MountHost";
import { useUI, type ThemePref } from "../store/ui";
import { workspaceStore } from "../core/workspace";
import {
  fetchPluginStore,
  fetchPlugins,
  installCommunityPlugin,
  pluginStore,
  setPluginEnabled,
  uninstallCommunityPlugin,
} from "../core/plugin-loader";
import { cn } from "../lib/cn";
import { notice } from "../components/ui/toast";
import { confirm } from "../components/ui/confirm";
import { Badge } from "../components/ui/badge";
import { EmptyState } from "../components/ui/empty-state";

export function SettingsDialog() {
  const open = useUI((s) => s.settingsOpen);
  const setOpen = useUI((s) => s.setSettingsOpen);
  const pluginTabs = useStore(workspaceStore, (s) => s.settingsTabs);
  const [active, setActive] = useState<string>("appearance");

  useEffect(() => {
    if (open) void Promise.all([fetchPlugins(), fetchPluginStore()]);
  }, [open]);

  const tabs: { id: string; title: string; icon?: typeof Sun }[] = [
    { id: "appearance", title: "Appearance", icon: Palette },
    { id: "plugins", title: "Plugins", icon: Puzzle },
    ...pluginTabs.map((t) => ({ id: `ext:${t.id}`, title: t.title })),
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Mobile-first: near-fullscreen sheet with horizontal tab strip;
          desktop: classic two-pane settings window. */}
      <DialogContent className="flex h-[85dvh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-0 p-0 md:h-[26rem] md:flex-row">
        <nav className="flex w-full shrink-0 gap-0.5 overflow-x-auto rounded-t-md border-b border-border bg-surface p-2 md:w-44 md:flex-col md:overflow-x-visible md:rounded-l-md md:rounded-tr-none md:border-r md:border-b-0">
          <DialogTitle className="hidden px-2 pt-1 pb-3 text-sm md:block">
            Settings
          </DialogTitle>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-2 text-left text-sm whitespace-nowrap transition-colors duration-100 md:w-full md:shrink md:py-1.5",
                active === tab.id
                  ? "bg-accent-soft text-foreground"
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {tab.icon && <tab.icon size={14} className="text-faint" />}
              {tab.title}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {active === "appearance" && <AppearanceTab />}
          {active === "plugins" && <PluginsTab />}
          {pluginTabs.map(
            (t) =>
              active === `ext:${t.id}` && (
                <MountHost key={t.id} mount={t.mount} />
              ),
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AppearanceTab() {
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const customTheme = useUI((s) => s.customTheme);
  const setCustomTheme = useUI((s) => s.setCustomTheme);
  const editorFontSize = useUI((s) => s.editorFontSize);
  const setEditorFontSize = useUI((s) => s.setEditorFontSize);
  const [themes, setThemes] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetch("/api/themes")
      .then((res) => (res.ok ? res.json() : []))
      .then(setThemes)
      .catch(() => setThemes([]));
  }, []);

  const options: { value: ThemePref; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  return (
    <section>
      <h3 className="text-sm font-semibold">Theme</h3>
      <p className="mt-1 text-sm text-muted">
        How Notable looks. “System” follows your OS preference.
      </p>
      <div className="mt-3 flex gap-2">
        {options.map((opt) => (
          <Button
            key={opt.value}
            variant={theme === opt.value ? "primary" : "secondary"}
            onClick={() => setTheme(opt.value)}
          >
            <opt.icon size={14} />
            {opt.label}
          </Button>
        ))}
      </div>

      <h3 className="mt-5 text-sm font-semibold">Editor font size</h3>
      <p className="mt-1 text-sm text-muted">
        Size of the note text in the editor.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Button
          size="icon"
          variant="secondary"
          aria-label="Decrease font size"
          disabled={editorFontSize <= 12}
          onClick={() => setEditorFontSize(Math.max(12, editorFontSize - 0.5))}
        >
          A-
        </Button>
        <span className="w-10 text-center text-sm text-muted">
          {editorFontSize}px
        </span>
        <Button
          size="icon"
          variant="secondary"
          aria-label="Increase font size"
          disabled={editorFontSize >= 22}
          onClick={() => setEditorFontSize(Math.min(22, editorFontSize + 0.5))}
        >
          A+
        </Button>
        {editorFontSize !== 15.5 && (
          <Button variant="ghost" size="sm" onClick={() => setEditorFontSize(15.5)}>
            Reset
          </Button>
        )}
      </div>

      {themes.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold">Custom theme</h3>
          <p className="mt-1 text-sm text-muted">
            CSS files from the themes directory, overriding the colors above.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant={customTheme === null ? "primary" : "secondary"}
              onClick={() => setCustomTheme(null)}
            >
              None
            </Button>
            {themes.map((t) => (
              <Button
                key={t.id}
                variant={customTheme === t.id ? "primary" : "secondary"}
                onClick={() => setCustomTheme(t.id)}
              >
                {t.name}
              </Button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function PluginsTab() {
  const available = useStore(pluginStore, (s) => s.available);
  const running = useStore(pluginStore, (s) => s.running);
  const store = useStore(pluginStore, (s) => s.store);
  const storeError = useStore(pluginStore, (s) => s.storeError);
  const registryUrl = useStore(pluginStore, (s) => s.registryUrl);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<"installed" | "browse">("installed");
  const [query, setQuery] = useState("");

  const toggle = async (id: string, enabled: boolean) => {
    setBusy(id);
    try {
      await setPluginEnabled(id, enabled);
    } catch (error) {
      notice(error instanceof Error ? error.message : "Could not update plugin", {
        variant: "danger",
      });
    } finally {
      setBusy(null);
    }
  };

  const install = async (id: string, update = false) => {
    setBusy(id);
    try {
      await installCommunityPlugin(id);
      notice(update ? "Plugin updated." : "Plugin installed.");
    } catch (error) {
      notice(error instanceof Error ? error.message : "Could not install plugin", {
        variant: "danger",
      });
    } finally {
      setBusy(null);
    }
  };

  const uninstall = async (id: string, name: string) => {
    if (!(await confirm(`Uninstall ${name}? Its saved settings will be kept.`))) {
      return;
    }
    setBusy(id);
    try {
      await uninstallCommunityPlugin(id);
      notice(`${name} uninstalled.`);
    } catch (error) {
      notice(error instanceof Error ? error.message : "Could not uninstall plugin", {
        variant: "danger",
      });
    } finally {
      setBusy(null);
    }
  };

  const filteredStore = store.filter((plugin) => {
    const needle = query.trim().toLowerCase();
    return (
      !needle ||
      plugin.name.toLowerCase().includes(needle) ||
      plugin.description.toLowerCase().includes(needle)
    );
  });

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-semibold">Plugins</h3>
        <div className="flex rounded-sm border border-border bg-surface p-0.5">
          {(["installed", "browse"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setView(tab)}
              className={cn(
                "rounded-sm px-2 py-1 text-xs capitalize",
                view === tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted hover:text-foreground",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Core plugins ship with Notable. Community plugins run with full access
        to the app and your notes, so only install code you trust.
      </p>

      {view === "installed" && available.length === 0 ? (
        <EmptyState icon={Puzzle} className="mt-4">
          No plugins are installed.
        </EmptyState>
      ) : view === "installed" ? (
        <ul className="mt-4 space-y-1">
          {available.map((p) => (
            <li
              key={p.id}
              className="flex items-start gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-faint">v{p.version}</span>
                  <Badge>{p.source}</Badge>
                  {running.has(p.id) && (
                    <span className="text-xs text-success">running</span>
                  )}
                </div>
                {p.description && (
                  <p className="mt-0.5 text-sm text-muted">
                    {p.description}
                  </p>
                )}
              </div>
              {p.userManaged && (
                <Button
                  variant="danger"
                  size="icon"
                  disabled={busy === p.id}
                  onClick={() => void uninstall(p.id, p.name)}
                  aria-label={`Uninstall ${p.name}`}
                  title="Uninstall"
                >
                  <Trash2 size={14} />
                </Button>
              )}
              <Switch
                checked={p.enabled}
                disabled={busy === p.id}
                onCheckedChange={(checked) => void toggle(p.id, checked)}
                aria-label={`Enable ${p.name}`}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4">
          <label className="relative block">
            <Search
              size={14}
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search community plugins"
              className="h-8 w-full rounded-sm border border-border bg-background pr-3 pl-8 text-sm outline-none focus:border-accent"
            />
          </label>
          {storeError ? (
            <p className="mt-3 text-sm text-danger">{storeError}</p>
          ) : filteredStore.length === 0 ? (
            <p className="mt-3 text-sm text-faint">
              {query ? "No plugins match your search." : "No community plugins available."}
            </p>
          ) : (
            <ul className="mt-3 space-y-1">
              {filteredStore.map((plugin) => (
                <li
                  key={plugin.id}
                  className="flex items-start gap-3 rounded-md border border-border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-medium">{plugin.name}</span>
                      <span className="text-xs text-faint">v{plugin.version}</span>
                      {plugin.author && (
                        <span className="text-xs text-faint">by {plugin.author}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-muted">
                      {plugin.description}
                    </p>
                  </div>
                  {plugin.homepage && (
                    <a
                      href={plugin.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-sm p-1.5 text-faint hover:bg-surface-hover hover:text-foreground"
                      aria-label={`${plugin.name} homepage`}
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                  <Button
                    variant={plugin.updateAvailable ? "primary" : "secondary"}
                    size="sm"
                    disabled={
                      busy !== null ||
                      !plugin.installable ||
                      (plugin.installed && !plugin.updateAvailable)
                    }
                    onClick={() =>
                      void install(plugin.id, plugin.updateAvailable)
                    }
                  >
                    {busy === plugin.id
                      ? "Working…"
                      : plugin.updateAvailable
                        ? "Update"
                        : plugin.installed
                          ? "Installed"
                          : plugin.installable
                            ? "Install"
                            : "Unavailable"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {registryUrl && (
            <p className="mt-3 truncate text-xs text-faint" title={registryUrl}>
              Registry: {registryUrl}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
