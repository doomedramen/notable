import { createStore } from "zustand";
import type { Disposable, PluginManifest, ThemeControl, ThemeSpec } from "@/plugin-api";
import { useUI } from "@/store/ui";

export interface RegisteredTheme extends ThemeSpec {
  id: string;
  pluginId: string;
  stylesheetUrl: string;
}

interface AppearanceState {
  themes: readonly RegisteredTheme[];
}

export const appearanceStore = createStore<AppearanceState>(() => ({
  themes: [],
}));

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const CSS_VARIABLE_PATTERN = /^--[a-z][a-z0-9-]*$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
/** A `font-family` value: comma-separated, quoted or bare family names. */
const FONT_PATTERN = /^[a-zA-Z0-9\s,'"_-]{1,200}$/;

export function registerTheme(
  manifest: PluginManifest,
  theme: ThemeSpec,
  stylesheetUrl: string,
): Disposable {
  validateTheme(theme);
  const registered: RegisteredTheme = {
    ...theme,
    id: namespaced(manifest.id, theme.id),
    pluginId: manifest.id,
    stylesheetUrl,
  };
  appearanceStore.setState((state) => ({
    themes: [...state.themes, registered],
  }));

  const selected = useUI.getState().customTheme;
  if (selected === registered.id) selectTheme(registered.id);

  return {
    dispose() {
      appearanceStore.setState((state) => ({
        themes: state.themes.filter((candidate) => candidate !== registered),
      }));
      if (useUI.getState().customTheme === registered.id) {
        useUI.getState().setCustomTheme(null);
      }
    },
  };
}

export function selectTheme(id: string | null): void {
  if (id === null) {
    useUI.getState().setCustomTheme(null);
    return;
  }
  const theme = appearanceStore.getState().themes.find((item) => item.id === id);
  if (!theme) return;
  useUI.getState().setCustomTheme(theme.id, theme.stylesheetUrl, variablesFor(theme));
}

export function selectLocalTheme(id: string | null): void {
  useUI.getState().setCustomTheme(id, id ? `/api/themes/${encodeURIComponent(id)}.css` : null);
}

export function setThemeControl(
  themeId: string,
  controlId: string,
  value: string | number | boolean,
): void {
  const theme = appearanceStore.getState().themes.find((item) => item.id === themeId);
  const control = theme?.controls?.find((item) => item.id === controlId);
  if (!theme || !control) return;
  const normalized = normalizeValue(control, value);
  const state = useUI.getState();
  const themeSettings = {
    ...state.themeSettings,
    [themeId]: {
      ...state.themeSettings[themeId],
      [controlId]: normalized,
    },
  };
  state.setThemeSettings(themeSettings, variablesFor(theme, themeSettings));
}

export function themeControlValue(
  theme: RegisteredTheme,
  control: ThemeControl,
): string | number | boolean {
  return useUI.getState().themeSettings[theme.id]?.[control.id] ?? control.default;
}

function variablesFor(
  theme: RegisteredTheme,
  settings = useUI.getState().themeSettings,
): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const control of theme.controls ?? []) {
    const value = settings[theme.id]?.[control.id] ?? control.default;
    if (control.type === "select") {
      const option = control.options.find((item) => item.value === value);
      if (!option) continue;
      if (control.cssVariable) variables[control.cssVariable] = option.value;
      Object.assign(variables, option.variables ?? {});
    } else if (control.type === "toggle") {
      variables[control.cssVariable] = value ? control.trueValue : control.falseValue;
    } else if (control.type === "number") {
      variables[control.cssVariable] = `${value}${control.unit ?? ""}`;
    } else {
      variables[control.cssVariable] = String(value);
    }
  }
  return variables;
}

function normalizeValue(
  control: ThemeControl,
  value: string | number | boolean,
): string | number | boolean {
  if (control.type === "color") {
    return typeof value === "string" && COLOR_PATTERN.test(value) ? value : control.default;
  }
  if (control.type === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) return control.default;
    return Math.min(control.max, Math.max(control.min, number));
  }
  if (control.type === "toggle") return Boolean(value);
  if (control.type === "font") {
    if (typeof value !== "string" || !FONT_PATTERN.test(value)) {
      return control.default;
    }
    if (control.options && !control.options.some((option) => option.value === value)) {
      return control.default;
    }
    return value;
  }
  return control.options.some((option) => option.value === value) ? String(value) : control.default;
}

function validateTheme(theme: ThemeSpec): void {
  if (!ID_PATTERN.test(theme.id) || !theme.name.trim()) {
    throw new Error("theme id and name are required");
  }
  const seen = new Set<string>();
  for (const control of theme.controls ?? []) {
    if (!ID_PATTERN.test(control.id) || seen.has(control.id)) {
      throw new Error(`invalid or duplicate theme control id "${control.id}"`);
    }
    seen.add(control.id);
    if ("cssVariable" in control && control.cssVariable) {
      validateCssVariable(control.cssVariable);
    }
    if (control.type === "color" && !COLOR_PATTERN.test(control.default)) {
      throw new Error(`invalid color default for "${control.id}"`);
    }
    if (
      control.type === "number" &&
      (control.min > control.max || control.default < control.min || control.default > control.max)
    ) {
      throw new Error(`invalid number range for "${control.id}"`);
    }
    if (control.type === "select") {
      if (
        control.options.length === 0 ||
        !control.options.some((option) => option.value === control.default)
      ) {
        throw new Error(`invalid select options for "${control.id}"`);
      }
      for (const option of control.options) {
        for (const variable of Object.keys(option.variables ?? {})) {
          validateCssVariable(variable);
        }
      }
    }
    if (control.type === "font") {
      if (!FONT_PATTERN.test(control.default)) {
        throw new Error(`invalid font default for "${control.id}"`);
      }
      if (control.options) {
        if (
          control.options.length === 0 ||
          !control.options.some((option) => option.value === control.default)
        ) {
          throw new Error(`invalid font options for "${control.id}"`);
        }
        for (const option of control.options) {
          if (!FONT_PATTERN.test(option.value)) {
            throw new Error(`invalid font option for "${control.id}"`);
          }
        }
      }
    }
  }
}

function validateCssVariable(variable: string): void {
  if (!CSS_VARIABLE_PATTERN.test(variable)) {
    throw new Error(`invalid CSS variable "${variable}"`);
  }
}

function namespaced(pluginId: string, id: string): string {
  return `${pluginId}:${id}`;
}
