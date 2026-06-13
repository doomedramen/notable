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
