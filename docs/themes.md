# Notable themes

Notable's appearance is controlled by CSS variables ("design tokens") defined
in `frontend/src/styles/tokens.css`. A theme is a plain `.css` file that
re-declares some or all of these variables to restyle the whole app.

## Installing a theme

Theme plugins appear under **Settings -> Plugins -> Browse -> Themes**. Install
and enable one, then select it under **Settings -> Appearance -> Custom
theme**. Theme plugins can expose host-rendered color, number, toggle, and
select controls. Their selected values are stored on the current device.

Plain local CSS themes remain supported:

Drop a `<name>.css` file into the themes directory (`--themes-dir` /
`THEMES_DIR`, default `./themes`, mounted as a volume in Docker). It appears
under **Settings -> Appearance -> Custom theme**, titled from its filename
(`solarized-light.css` -> "Solarized light"). Selecting it loads
`/api/themes/<name>.css` after the built-in stylesheet, so your rules override
the defaults. Selecting "None" removes it.

## Writing a theme

Override variables under `:root` for the light theme and `[data-theme="dark"]`
for the dark theme. You don't need to redefine every variable — anything you
omit falls back to the built-in token.

```css
:root {
  --background: #fdf6e3;
  --foreground: #073642;
  --accent: #268bd2;
}

[data-theme="dark"] {
  --background: #002b36;
  --foreground: #eee8d5;
  --accent: #2aa198;
}
```

See `frontend/src/styles/tokens.css` for the full list of variables and
`themes/nord.css` in this repo for a complete example. In addition to colors
and fonts, themes can tune:

- `--space-1` through `--space-6` for the shared spacing rhythm.
- `--editor-measure` and `--sidebar-width` for the primary layout proportions.
- `--radius`, `--radius-sm`, and `--radius-lg` for control and surface shape.
- `--motion-feedback`, `--motion-transition`, and `--motion-structural` for
  pressed states, view changes, and larger panel transitions.
- `--ease-standard` and `--ease-emphasized` for transition character.
- `--shadow-popover`, `--shadow-dialog`, `--shadow-float`,
  `--shadow-float-hover`, and `--shadow-float-pressed` for surface elevation.

Keep motion values short and restrained. Notable disables animation when the
user requests reduced motion, regardless of the active theme.

## Theme plugins

API v2 plugins register a theme and ship its CSS as a regular package asset:

```js
export default {
  onload(api) {
    api.appearance.registerTheme({
      id: "ocean",
      name: "Ocean",
      stylesheet: "theme.css",
      controls: [
        {
          id: "accent",
          label: "Accent",
          type: "color",
          cssVariable: "--accent",
          default: "#268bd2"
        },
        {
          id: "radius",
          label: "Corner radius",
          type: "number",
          cssVariable: "--radius",
          default: 8,
          min: 0,
          max: 16,
          unit: "px"
        }
      ]
    });
  }
};
```

Theme and control IDs are namespaced to the plugin automatically. CSS
variables must use lowercase `--kebab-case` names. Disabling the plugin removes
its stylesheet and restores the built-in appearance immediately.
