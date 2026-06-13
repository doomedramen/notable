# Notable themes

Notable's appearance is controlled by CSS variables ("design tokens") defined
in `frontend/src/styles/tokens.css`. A theme is a plain `.css` file that
re-declares some or all of these variables to restyle the whole app.

## Installing a theme

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

See `frontend/src/styles/tokens.css` for the full list of variables
(surfaces, borders, accent, danger/success/warning, radii, shadows, fonts) and
`themes/nord.css` in this repo for a complete example.
