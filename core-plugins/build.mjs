#!/usr/bin/env node
// Type-checks and bundles every core-plugins/<id>/src/main.ts into
// core-plugins/<id>/main.js, the entry file referenced by manifest.json.
//
// @codemirror/* and yjs are marked external: plugins must consume the host
// instances exposed at api.modules, never bundle their own copy.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const entries = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(root, entry.name, "src", "main.ts"))
  .filter((entryPoint) => existsSync(entryPoint));

if (entries.length === 0) {
  console.log("No TypeScript core plugins found.");
  process.exit(0);
}

console.log(`Type-checking ${entries.length} core plugin(s)...`);
execFileSync("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], {
  cwd: root,
  stdio: "inherit",
});

for (const entryPoint of entries) {
  const outfile = join(dirname(dirname(entryPoint)), "main.js");
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: "esm",
    target: "es2022",
    external: ["@codemirror/*", "yjs"],
    logLevel: "info",
  });
}
