import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { Monitor, Moon, Palette, Puzzle, Sun } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Switch } from "../components/ui/switch";
import { Button } from "../components/ui/button";
import { MountHost } from "../components/MountHost";
import { useUI, type ThemePref } from "../store/ui";
import { workspaceStore } from "../core/workspace";
import {
  fetchPlugins,
  pluginStore,
  setPluginEnabled,
} from "../core/plugin-loader";
import { cn } from "../lib/cn";

type BuiltinTab = "appearance" | "plugins";

export function SettingsDialog() {
  const open = useUI((s) => s.settingsOpen);
  const setOpen = useUI((s) => s.setSettingsOpen);
  const pluginTabs = useStore(workspaceStore, (s) => s.settingsTabs);
  const [active, setActive] = useState<string>("appearance");

  useEffect(() => {
    if (open) void fetchPlugins();
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
          <DialogTitle className="hidden px-2 pt-1 pb-3 text-[13px] md:block">
            Settings
          </DialogTitle>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-sm px-2.5 py-2 text-left text-[13px] whitespace-nowrap transition-colors md:w-full md:shrink md:py-1.5",
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
        <div className="min-w-0 flex-1 overflow-y-auto p-5">
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

  const options: { value: ThemePref; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  return (
    <section>
      <h3 className="text-[13px] font-semibold">Theme</h3>
      <p className="mt-1 text-[13px] text-muted">
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
    </section>
  );
}

function PluginsTab() {
  const available = useStore(pluginStore, (s) => s.available);
  const running = useStore(pluginStore, (s) => s.running);
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (id: string, enabled: boolean) => {
    setBusy(id);
    try {
      await setPluginEnabled(id, enabled);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <h3 className="text-[13px] font-semibold">Plugins</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Plugins are folders in the server’s plugins directory. They run with
        full access to the app and your notes — only install code you trust.
      </p>
      {available.length === 0 ? (
        <p className="mt-4 text-[13px] text-faint">
          No plugins installed. Drop a plugin folder into the server’s{" "}
          <code className="rounded-sm bg-surface px-1 font-mono text-xs">
            plugins/
          </code>{" "}
          directory and reopen this dialog.
        </p>
      ) : (
        <ul className="mt-4 space-y-1">
          {available.map((p) => (
            <li
              key={p.id}
              className="flex items-start gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium">{p.name}</span>
                  <span className="text-xs text-faint">v{p.version}</span>
                  {running.has(p.id) && (
                    <span className="text-xs text-success">running</span>
                  )}
                </div>
                {p.description && (
                  <p className="mt-0.5 text-[13px] text-muted">
                    {p.description}
                  </p>
                )}
              </div>
              <Switch
                checked={p.enabled}
                disabled={busy === p.id}
                onCheckedChange={(checked) => void toggle(p.id, checked)}
                aria-label={`Enable ${p.name}`}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
