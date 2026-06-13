import { beforeEach, describe, expect, it } from "vitest";
import {
  appearanceStore,
  registerTheme,
  selectTheme,
  setThemeControl,
} from "./appearance";
import { useUI } from "../store/ui";

describe("appearance registry", () => {
  beforeEach(() => {
    appearanceStore.setState({ themes: [] });
    useUI.setState({
      customTheme: null,
      customThemeUrl: null,
      customThemeVariables: {},
      themeSettings: {},
    });
  });

  it("namespaces themes, applies controls, and clears on dispose", () => {
    const disposable = registerTheme(
      { id: "colors", name: "Colors", version: "1.0.0" },
      {
        id: "ocean",
        name: "Ocean",
        stylesheet: "theme.css",
        controls: [
          {
            id: "radius",
            label: "Radius",
            type: "number",
            cssVariable: "--radius",
            default: 8,
            min: 0,
            max: 16,
            unit: "px",
          },
        ],
      },
      "/api/plugins/colors/theme.css",
    );

    expect(appearanceStore.getState().themes[0]?.id).toBe("colors:ocean");
    selectTheme("colors:ocean");
    expect(useUI.getState().customThemeUrl).toContain("theme.css");
    expect(useUI.getState().customThemeVariables["--radius"]).toBe("8px");

    setThemeControl("colors:ocean", "radius", 40);
    expect(useUI.getState().customThemeVariables["--radius"]).toBe("16px");

    disposable.dispose();
    expect(appearanceStore.getState().themes).toHaveLength(0);
    expect(useUI.getState().customTheme).toBeNull();
  });

  it("applies and validates font controls", () => {
    registerTheme(
      { id: "type", name: "Type", version: "1.0.0" },
      {
        id: "set",
        name: "Set",
        stylesheet: "theme.css",
        controls: [
          {
            id: "family",
            label: "Font",
            type: "font",
            cssVariable: "--font-family",
            default: "Inter, sans-serif",
            options: [
              { label: "Inter", value: "Inter, sans-serif" },
              { label: "Mono", value: "'Fira Code', monospace" },
            ],
          },
        ],
      },
      "/api/plugins/type/theme.css",
    );

    selectTheme("type:set");
    expect(useUI.getState().customThemeVariables["--font-family"]).toBe(
      "Inter, sans-serif",
    );

    setThemeControl("type:set", "family", "'Fira Code', monospace");
    expect(useUI.getState().customThemeVariables["--font-family"]).toBe(
      "'Fira Code', monospace",
    );

    // Not one of the curated options: falls back to the default.
    setThemeControl("type:set", "family", "Comic Sans MS");
    expect(useUI.getState().customThemeVariables["--font-family"]).toBe(
      "Inter, sans-serif",
    );
  });

  it("rejects unsafe font defaults", () => {
    expect(() =>
      registerTheme(
        { id: "bad-font", name: "Bad font", version: "1.0.0" },
        {
          id: "bad",
          name: "Bad",
          stylesheet: "theme.css",
          controls: [
            {
              id: "family",
              label: "Font",
              type: "font",
              cssVariable: "--font-family",
              default: "url(javascript:alert(1))",
            },
          ],
        },
        "/theme.css",
      ),
    ).toThrow(/invalid font default/);
  });

  it("rejects unsafe CSS variable names", () => {
    expect(() =>
      registerTheme(
        { id: "bad", name: "Bad", version: "1.0.0" },
        {
          id: "bad",
          name: "Bad",
          stylesheet: "theme.css",
          controls: [
            {
              id: "color",
              label: "Color",
              type: "color",
              cssVariable: "background",
              default: "#ffffff",
            },
          ],
        },
        "/theme.css",
      ),
    ).toThrow(/invalid CSS variable/);
  });
});
