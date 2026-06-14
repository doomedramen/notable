import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useStore } from "zustand";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { MountHost } from "@/components/MountHost";
import { useUI, type ThemePref } from "@/store/ui";
import { workspaceStore } from "@/core/workspace";
import {
  fetchPluginStore,
  installCommunityPlugin,
  loadEnabledPlugins,
  pluginStore,
  setPluginEnabled,
  uninstallCommunityPlugin,
} from "@/core/plugin-loader";
import { cn } from "@/lib/cn";
import { notice } from "@/components/ui/toast";
import { confirm } from "@/components/ui/confirm";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AppIcon } from "@/components/AppIcon";
import type { AppIconSlot, IconSource, ThemeControl } from "@/plugin-api";
import {
  appearanceStore,
  selectLocalTheme,
  selectTheme,
  setThemeControl,
  themeControlValue,
} from "@/core/appearance";
import { iconsStore, selectIconTheme } from "@/core/icons";
import { triggerFeedback } from "@/core/feedback";

const SHEET_DISMISS_THRESHOLD = 110;

export function SettingsDialog() {
  const open = useUI((s) => s.settingsOpen);
  const setOpen = useUI((s) => s.setSettingsOpen);
  const pluginTabs = useStore(workspaceStore, (s) => s.settingsTabs);
  const [active, setActive] = useState<string>("appearance");
  const [sheetOffset, setSheetOffset] = useState(0);
  const [draggingSheet, setDraggingSheet] = useState(false);
  const sheetOffsetRef = useRef(0);
  const sheetDrag = useRef<{
    pointerId: number;
    startY: number;
    touch: boolean;
    feedbackTriggered: boolean;
  } | null>(null);

  useEffect(() => {
    if (open) {
      sheetOffsetRef.current = 0;
      setSheetOffset(0);
      void Promise.all([loadEnabledPlugins(), fetchPluginStore()]);
    }
  }, [open]);

  const startSheetDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 768) return;
    sheetDrag.current = {
      pointerId: event.pointerId,
      startY: event.clientY - sheetOffset,
      touch: event.pointerType === "touch",
      feedbackTriggered: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingSheet(true);
  };

  const moveSheet = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = sheetDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const offset = Math.max(0, event.clientY - drag.startY);
    if (
      drag.touch &&
      offset >= SHEET_DISMISS_THRESHOLD &&
      !drag.feedbackTriggered
    ) {
      drag.feedbackTriggered = true;
      triggerFeedback("selection");
    }
    sheetOffsetRef.current = offset;
    setSheetOffset(offset);
  };

  const finishSheetDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = sheetDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    sheetDrag.current = null;
    setDraggingSheet(false);
    if (sheetOffsetRef.current >= SHEET_DISMISS_THRESHOLD) setOpen(false);
    else {
      sheetOffsetRef.current = 0;
      setSheetOffset(0);
    }
  };

  const tabs: { id: string; title: string; icon?: IconSource }[] = [
    { id: "appearance", title: "Appearance", icon: "appearance" },
    { id: "plugins", title: "Plugins", icon: "plugins" },
    ...pluginTabs.map((t) => ({
      id: `ext:${t.id}`,
      title: t.title,
      icon: t.icon,
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Mobile-first: near-fullscreen sheet with horizontal tab strip;
          desktop: classic two-pane settings window. */}
      <DialogContent
        style={{
          transform:
            sheetOffset > 0 ? `translateY(${sheetOffset}px)` : undefined,
          transition: draggingSheet
            ? "none"
            : "transform var(--motion-structural) var(--ease-emphasized)",
        }}
        className="settings-sheet bottom-[var(--keyboard-inset,0px)] top-auto left-0 flex h-[88dvh] max-h-[calc(100dvh-var(--keyboard-inset,0px))] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-b-none p-0 md:top-1/2 md:left-1/2 md:h-[26rem] md:max-w-2xl md:-translate-x-1/2 md:-translate-y-1/2 md:flex-row md:rounded-md"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Customize Notable appearance, plugins, and extensions.
        </DialogDescription>
        <div
          className="flex h-6 shrink-0 touch-none items-center justify-center md:hidden"
          data-testid="settings-sheet-handle"
          aria-hidden
          onPointerDown={startSheetDrag}
          onPointerMove={moveSheet}
          onPointerUp={finishSheetDrag}
          onPointerCancel={finishSheetDrag}
        >
          <span className="h-1 w-9 rounded-full bg-border-strong" />
        </div>
        <nav
          data-testid="settings-tabs"
          className="flex w-full shrink-0 gap-0.5 overflow-x-auto rounded-t-md border-b border-border bg-surface p-2 md:w-44 md:flex-col md:overflow-x-visible md:rounded-l-md md:rounded-tr-none md:border-r md:border-b-0"
        >
          <div className="hidden px-2 pt-1 pb-3 text-sm font-semibold md:block">
            Settings
          </div>
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
              {tab.icon && (
                <AppIcon icon={tab.icon} size={14} className="text-faint" />
              )}
              {tab.title}
            </button>
          ))}
        </nav>
        <div
          data-testid="settings-content"
          className="min-w-0 flex-1 overflow-y-auto overscroll-contain p-5"
        >
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
  useUI((s) => s.themeSettings);
  const appIconTheme = useUI((s) => s.appIconTheme);
  const editorFontSize = useUI((s) => s.editorFontSize);
  const setEditorFontSize = useUI((s) => s.setEditorFontSize);
  const hapticsEnabled = useUI((s) => s.hapticsEnabled);
  const setHapticsEnabled = useUI((s) => s.setHapticsEnabled);
  const [themes, setThemes] = useState<{ id: string; name: string }[]>([]);
  const pluginThemes = useStore(appearanceStore, (s) => s.themes);
  const iconThemes = useStore(iconsStore, (s) => s.themes);

  useEffect(() => {
    fetch("/api/themes")
      .then((res) => (res.ok ? res.json() : []))
      .then(setThemes)
      .catch(() => setThemes([]));
  }, []);

  const options: {
    value: ThemePref;
    label: string;
    icon: AppIconSlot;
  }[] = [
    { value: "light", label: "Light", icon: "theme-light" },
    { value: "dark", label: "Dark", icon: "theme-dark" },
    { value: "system", label: "System", icon: "theme-system" },
  ];
  const activePluginTheme = pluginThemes.find(
    (candidate) => candidate.id === customTheme,
  );

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
            <AppIcon icon={opt.icon} size={14} />
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
        {editorFontSize !== 14 && (
          <Button variant="ghost" size="sm" onClick={() => setEditorFontSize(14)}>
            Reset
          </Button>
        )}
      </div>

      <h3 className="mt-5 text-sm font-semibold">Interaction</h3>
      <label className="mt-3 flex items-center justify-between gap-4 rounded-md border border-border bg-surface px-3 py-2.5">
        <span className="min-w-0">
          <span className="block text-sm font-medium">Haptic feedback</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted">
            Subtle tactile confirmation on supported touch devices.
          </span>
        </span>
        <Switch
          checked={hapticsEnabled}
          onCheckedChange={setHapticsEnabled}
          aria-label="Haptic feedback"
        />
      </label>

      {(themes.length > 0 || pluginThemes.length > 0) && (
        <>
          <h3 className="mt-5 text-sm font-semibold">Custom theme</h3>
          <p className="mt-1 text-sm text-muted">
            Installed theme plugins and CSS files from the themes directory.
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
                onClick={() => selectLocalTheme(t.id)}
              >
                {t.name}
              </Button>
            ))}
            {pluginThemes.map((registered) => (
              <Button
                key={registered.id}
                variant={
                  customTheme === registered.id ? "primary" : "secondary"
                }
                onClick={() => selectTheme(registered.id)}
              >
                {registered.name}
              </Button>
            ))}
          </div>
        </>
      )}

      {activePluginTheme && (activePluginTheme.controls?.length ?? 0) > 0 && (
        <section className="mt-5 border-t border-border pt-5">
          <h3 className="text-sm font-semibold">
            {activePluginTheme.name} settings
          </h3>
          <div className="mt-3 space-y-3">
            {activePluginTheme.controls?.map((control) => (
              <ThemeControlField
                key={control.id}
                themeId={activePluginTheme.id}
                control={control}
                value={themeControlValue(activePluginTheme, control)}
              />
            ))}
          </div>
        </section>
      )}

      {iconThemes.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold">Application icons</h3>
          <p className="mt-1 text-sm text-muted">
            Replace Notable's built-in interface icons with an installed pack.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant={appIconTheme === null ? "primary" : "secondary"}
              onClick={() => selectIconTheme(null)}
            >
              Built-in
            </Button>
            {iconThemes.map((iconTheme) => (
              <Button
                key={iconTheme.id}
                variant={
                  appIconTheme === iconTheme.id ? "primary" : "secondary"
                }
                onClick={() => selectIconTheme(iconTheme.id)}
              >
                {iconTheme.name}
              </Button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ThemeControlField({
  themeId,
  control,
  value,
}: {
  themeId: string;
  control: ThemeControl;
  value: string | number | boolean;
}) {
  const labelClass = "flex items-center justify-between gap-3 text-sm";
  if (control.type === "toggle") {
    return (
      <label className={labelClass}>
        <span>{control.label}</span>
        <Switch
          checked={Boolean(value)}
          onCheckedChange={(checked) =>
            setThemeControl(themeId, control.id, checked)
          }
        />
      </label>
    );
  }
  if (control.type === "select") {
    return (
      <label className={labelClass}>
        <span>{control.label}</span>
        <select
          value={String(value)}
          onChange={(event) =>
            setThemeControl(themeId, control.id, event.target.value)
          }
          className="h-8 rounded-sm border border-border bg-background px-2 text-sm"
        >
          {control.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (control.type === "font") {
    if (control.options) {
      return (
        <label className={labelClass}>
          <span>{control.label}</span>
          <select
            value={String(value)}
            onChange={(event) =>
              setThemeControl(themeId, control.id, event.target.value)
            }
            className="h-8 rounded-sm border border-border bg-background px-2 text-sm"
            style={{ fontFamily: String(value) }}
          >
            {control.options.map((option) => (
              <option
                key={option.value}
                value={option.value}
                style={{ fontFamily: option.value }}
              >
                {option.label}
              </option>
            ))}
          </select>
        </label>
      );
    }
    return (
      <label className={labelClass}>
        <span>{control.label}</span>
        <input
          type="text"
          value={String(value)}
          onChange={(event) =>
            setThemeControl(themeId, control.id, event.target.value)
          }
          style={{ fontFamily: String(value) }}
          className="h-8 w-48 rounded-sm border border-border bg-background px-2 text-sm"
        />
      </label>
    );
  }
  if (control.type === "color") {
    return (
      <label className={labelClass}>
        <span>{control.label}</span>
        <input
          type="color"
          value={String(value)}
          onChange={(event) =>
            setThemeControl(themeId, control.id, event.target.value)
          }
          className="h-8 w-12 cursor-pointer rounded-sm border border-border bg-background p-1"
        />
      </label>
    );
  }
  return (
    <label className={labelClass}>
      <span>{control.label}</span>
      <input
        type="number"
        value={Number(value)}
        min={control.min}
        max={control.max}
        step={control.step ?? 1}
        onChange={(event) =>
          setThemeControl(themeId, control.id, Number(event.target.value))
        }
        className="h-8 w-24 rounded-sm border border-border bg-background px-2 text-sm"
      />
    </label>
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
  const [category, setCategory] = useState<"plugins" | "themes" | "icons">(
    "plugins",
  );

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
    const categoryMatch =
      category === "themes"
        ? plugin.categories.includes("theme")
        : category === "icons"
          ? plugin.categories.includes("icons")
          : !plugin.categories.some(
              (item) => item === "theme" || item === "icons",
            );
    return (
      categoryMatch &&
      (!needle ||
        plugin.name.toLowerCase().includes(needle) ||
        plugin.description.toLowerCase().includes(needle))
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
        <EmptyState icon="plugins" className="mt-4">
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
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
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
                  <AppIcon icon="trash" size={14} />
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
          <div className="mb-3 flex gap-1 rounded-sm border border-border bg-surface p-1">
            {(["plugins", "themes", "icons"] as const).map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={cn(
                  "flex-1 rounded-sm px-2 py-1 text-xs capitalize",
                  category === item
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted hover:text-foreground",
                )}
              >
                {item}
              </button>
            ))}
          </div>
          <label className="relative block">
            <AppIcon
              icon="search"
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
                      <AppIcon icon="external-link" size={14} />
                    </a>
                  )}
                  <Button
                    variant={plugin.updateAvailable ? "primary" : "secondary"}
                    size="sm"
                    disabled={
                      busy !== null ||
                      !plugin.installable ||
                      !plugin.compatible ||
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
                          : !plugin.compatible
                            ? "Requires newer Notable"
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
