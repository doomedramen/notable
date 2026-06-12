import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const VAULT = "/tmp/notable-e2e-vault";
const DATABASE = "/tmp/notable-e2e.db";

/** Create a note via the "+" menu; returns its vault-relative path. */
async function createNote(page: Page): Promise<string> {
  await page.getByLabel("New…").click();
  await page.getByRole("menuitem", { name: "New note" }).click();
  await expect(page).toHaveURL(/\/note\//);
  return decodeURIComponent(
    new URL(page.url()).pathname.replace(/^\/note\//, ""),
  );
}

async function typeInEditor(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.type(text);
}

test("create a note, type, persists across reload — and is a real file", async ({
  page,
}) => {
  await page.goto("/");
  const notePath = await createNote(page);
  await typeInEditor(page, "# Smoke test");
  await page.keyboard.press("Enter");
  await page.keyboard.type("hello world");
  await expect(page.locator("footer")).toContainText("Synced");

  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("hello world");

  // Files are canonical: the server's write-behind must land on disk.
  const file = path.join(VAULT, notePath);
  await expect(async () => {
    expect(fs.readFileSync(file, "utf8")).toContain("hello world");
  }).toPass({ timeout: 10_000 });
});

test("offline edits are flagged and recover on reconnect", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await createNote(page);
  await typeInEditor(page, "first line");
  await expect(page.locator("footer")).toContainText("Synced");

  await context.setOffline(true);
  await page.keyboard.type(" — offline edit");
  await expect(page.locator("footer")).toContainText("Offline");

  await context.setOffline(false);
  await expect(page.locator("footer")).toContainText("Synced", {
    timeout: 15_000,
  });
});

test("offline edits persist across a reload", async ({ page, context }) => {
  await page.goto("/");
  const notePath = await createNote(page);
  await typeInEditor(page, "saved online");
  await expect(page.locator("footer")).toContainText("Synced");

  // Wait for the PWA shell to be ready and controlled before taking the
  // browser offline, otherwise the reload itself cannot reach the app.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        );
      });
    }
  });

  await context.setOffline(true);
  await page.keyboard.type(" and edited offline");
  await expect(page.locator("footer")).toContainText("Offline");
  // Guard: the offline keystrokes must be in the live editor before we
  // measure persistence (distinguishes "lost at reload" from "never typed").
  await expect(page.locator(".cm-content")).toContainText(
    "saved online and edited offline",
  );

  await page.reload();
  await expect(page.locator(".cm-content")).toContainText(
    "saved online and edited offline",
  );

  await context.setOffline(false);
  await expect(page.locator("footer")).toContainText("Synced", {
    timeout: 15_000,
  });
  await expect(page.locator(".cm-content")).toContainText(
    "saved online and edited offline",
  );
  await expect(async () => {
    expect(fs.readFileSync(path.join(VAULT, notePath), "utf8")).toContain(
      "saved online and edited offline",
    );
  }).toPass({ timeout: 10_000 });

  await page.reload();
  await expect(page.locator(".cm-content")).toContainText(
    "saved online and edited offline",
  );
});

test("external file edits merge live into an open editor", async ({ page }) => {
  await page.goto("/");
  const notePath = await createNote(page);
  await typeInEditor(page, "written in the app");
  await expect(page.locator("footer")).toContainText("Synced");

  // Wait for the write-behind flush so we edit the settled file.
  const file = path.join(VAULT, notePath);
  await expect(async () => {
    expect(fs.readFileSync(file, "utf8")).toContain("written in the app");
  }).toPass({ timeout: 10_000 });

  fs.writeFileSync(file, "written in the app\n\nadded by an external tool\n");

  // Watcher → text diff → broadcast → editor.
  await expect(page.locator(".cm-content")).toContainText(
    "added by an external tool",
    { timeout: 10_000 },
  );
});

test("a stale file event cannot erase in-flight typing", async ({ page }) => {
  await page.goto("/");
  const notePath = await createNote(page);
  await expect(page.locator("footer")).toContainText("Synced");

  // The active room must not depend on the derived cache row to recognize
  // that an unchanged file event is stale.
  execFileSync("sqlite3", [
    DATABASE,
    `DELETE FROM doc_cache WHERE path = '${notePath.replaceAll("'", "''")}'`,
  ]);

  await typeInEditor(page, "keep this text");
  fs.writeFileSync(path.join(VAULT, notePath), "");

  // Watcher debounce is 400ms. Give it enough time to process the stale
  // empty-file event before checking that the editor was not rolled back.
  await page.waitForTimeout(1_000);
  await expect(page.locator(".cm-content")).toContainText("keep this text");
  await expect(async () => {
    expect(fs.readFileSync(path.join(VAULT, notePath), "utf8")).toContain(
      "keep this text",
    );
  }).toPass({ timeout: 10_000 });
});

test("rename a note from the sidebar context menu", async ({ page }) => {
  await page.goto("/");
  const notePath = await createNote(page);
  const oldName = notePath.replace(/\.md$/, "");
  const newName = `Renamed ${Date.now()}`;

  await page
    .locator("nav")
    .getByRole("button", { name: oldName, exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.getByLabel("New name").fill(newName);
  await page.getByRole("button", { name: "Rename", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(encodeURIComponent(newName)));
  await expect(page.locator("nav")).toContainText(newName);
  await expect(async () => {
    expect(fs.existsSync(path.join(VAULT, `${newName}.md`))).toBe(true);
    expect(fs.existsSync(path.join(VAULT, notePath))).toBe(false);
  }).toPass({ timeout: 5_000 });
});

test("create a folder and a note inside it", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("New…").click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Projects");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.locator("nav")).toContainText("Projects");
  expect(fs.statSync(path.join(VAULT, "Projects")).isDirectory()).toBe(true);

  await page
    .locator("nav")
    .getByRole("button", { name: "Projects", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "New note here" }).click();
  await expect(page).toHaveURL(/\/note\/Projects\//);
});

test("full-text search finds notes by content in the palette", async ({
  page,
}) => {
  await page.goto("/");
  const notePath = await createNote(page);
  await typeInEditor(
    page,
    "# Recipes\n\nThe secret ingredient is cardamom obviously",
  );
  await expect(page.locator("footer")).toContainText("Synced");

  // Indexing happens on the write-behind flush (~2s idle).
  await expect(async () => {
    const res = await page.request.get("/api/search?q=cardamom");
    const hits = (await res.json()) as { path: string }[];
    expect(hits.some((h) => h.path === notePath)).toBe(true);
  }).toPass({ timeout: 10_000 });

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search notes and commands…").fill("cardamom");

  // The Content group surfaces the match with a highlighted snippet.
  const hit = page.getByRole("option", { name: /cardamom/ }).first();
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(
    new RegExp(encodeURIComponent(notePath.replace(/\.md$/, ""))),
  );
});

test("command palette opens with Mod-K and runs commands", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByPlaceholder("Search notes and commands…");
  await expect(input).toBeVisible();

  await input.fill("settings");
  await page.getByRole("option", { name: /Open settings/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Appearance");
  await expect(page.getByRole("dialog")).toContainText("Plugins");
});

test("word-count plugin enables and disables live, without reload", async ({
  page,
}) => {
  await page.goto("/");
  await createNote(page);
  await typeInEditor(page, "five words are typed here");

  // Open settings → Plugins, toggle the plugin on.
  await page.getByLabel("Settings").click();
  await page.getByRole("dialog").getByRole("button", { name: "Plugins" }).click();
  await expect(page.getByRole("dialog")).toContainText("Word count");
  await page.getByLabel("Enable Word count").click();

  await expect(page.locator("footer")).toContainText("5 words");

  // Live disable: the status bar item must disappear.
  await page.getByLabel("Enable Word count").click();
  await expect(page.locator("footer")).not.toContainText("words");
});
