import { beforeEach, describe, expect, it } from "vitest";
import { applyCustomThemeStylesheet } from "./ThemeProvider";

describe("applyCustomThemeStylesheet", () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <meta name="theme-color" content="#ffffff">
      <link id="notable-custom-theme" rel="stylesheet" href="data:text/css,:root{}">
      <link id="app-styles" rel="stylesheet" href="data:text/css,:root{}">
    `;
  });

  it("moves a pre-paint theme after the app stylesheet", () => {
    const themeUrl = "data:text/css,:root{--background:%23ffffff}";
    const cleanup = applyCustomThemeStylesheet("nord", themeUrl);
    const stylesheets = [...document.head.querySelectorAll("link")];

    expect(stylesheets.map((link) => link.id)).toEqual([
      "app-styles",
      "notable-custom-theme",
    ]);
    expect(stylesheets[1]?.getAttribute("href")).toBe(themeUrl);
    cleanup();
  });

  it("removes the custom stylesheet when the theme is cleared", () => {
    applyCustomThemeStylesheet(null, null);
    expect(document.getElementById("notable-custom-theme")).toBeNull();
  });
});
