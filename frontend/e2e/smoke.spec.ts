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

test("rename a note from the editor title", async ({ page }) => {
  await page.goto("/");
  const notePath = await createNote(page);
  const oldName = notePath.replace(/\.md$/, "").split("/").pop()!;
  const newName = `Renamed from editor ${Date.now()}`;

  await page.getByRole("heading", { name: oldName, exact: true }).click();
  const input = page.getByLabel("Note title");
  await input.fill(newName);
  await input.press("Enter");

  await expect(page).toHaveURL(new RegExp(encodeURIComponent(newName)));
  await expect(page.getByRole("heading", { name: newName })).toBeVisible();
  await expect(async () => {
    expect(fs.existsSync(path.join(VAULT, `${newName}.md`))).toBe(true);
    expect(fs.existsSync(path.join(VAULT, notePath))).toBe(false);
  }).toPass({ timeout: 5_000 });
});

test("delete an empty folder, but not a non-empty one", async ({ page }) => {
  await page.goto("/");

  // Empty folder
  await page.getByLabel("New…").click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  const emptyFolder = `Empty ${Date.now()}`;
  await page.getByLabel("Folder name").fill(emptyFolder);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("nav")).toContainText(emptyFolder);

  // Non-empty folder with a note inside
  await page.getByLabel("New…").click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  const fullFolder = `Full ${Date.now()}`;
  await page.getByLabel("Folder name").fill(fullFolder);
  await page.getByRole("button", { name: "Create" }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: fullFolder, exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "New note here" }).click();
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(fullFolder)}/`));

  // Deleting the non-empty folder is refused.
  await page
    .locator("nav")
    .getByRole("button", { name: fullFolder, exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete folder" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator("nav")).toContainText(fullFolder);
  await expect(
    page.getByText("Folder is not empty."),
  ).toBeVisible();
  expect(fs.statSync(path.join(VAULT, fullFolder)).isDirectory()).toBe(true);

  // Deleting the empty folder succeeds and removes it from disk.
  await page
    .locator("nav")
    .getByRole("button", { name: emptyFolder, exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete folder" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator("nav")).not.toContainText(emptyFolder);
  expect(fs.existsSync(path.join(VAULT, emptyFolder))).toBe(false);
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

test("enabled plugins recover after startup discovery fails", async ({ page }) => {
  let pluginRequests = 0;
  await page.route("**/api/plugins", async (route) => {
    pluginRequests += 1;
    if (pluginRequests === 1) {
      await route.abort("connectionfailed");
    } else {
      await route.continue();
    }
  });

  await page.goto("/");
  await page.getByLabel("Settings").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Plugins" }).click();

  await expect
    .poll(async () => {
      const rows = dialog.locator("li");
      let enabled = 0;
      for (let index = 0; index < (await rows.count()); index += 1) {
        const row = rows.nth(index);
        const toggle = row.getByRole("switch");
        if ((await toggle.count()) === 0 || !(await toggle.isChecked())) continue;
        enabled += 1;
        if (!(await row.textContent())?.includes("running")) return false;
      }
      return enabled > 0;
    })
    .toBe(true);
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

test("wikilinks render as pills and Mod-click creates + opens the target", async ({
  page,
}) => {
  await page.goto("/");
  await createNote(page);
  await typeInEditor(page, "Link: [[Note B]]");

  // Dismiss any autocomplete popup, then move the cursor off the line so
  // the link decoration (hidden brackets, pill) takes effect.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");

  const pill = page.locator(".cm-wikilink", { hasText: "Note B" });
  await expect(pill).toBeVisible();
  await expect(page.locator(".cm-content")).not.toContainText("[[");

  // Mod-click an unresolved link: creates "Note B.md" and navigates to it.
  await pill.click({ modifiers: ["Control"] });
  await expect(page).toHaveURL(/Note%20B/);
  await expect(page.locator("h1")).toContainText("Note B");
});

test("backlinks panel lists notes that link to the open note", async ({
  page,
}) => {
  await page.goto("/");
  await createNote(page);
  await typeInEditor(page, "See [[Note C]] for details");
  await page.keyboard.press("Escape");
  await expect(page.locator("footer")).toContainText("Synced");

  // Follow the link: creates + opens "Note C.md".
  await page.keyboard.press("Enter");
  await page
    .locator(".cm-wikilink", { hasText: "Note C" })
    .click({ modifiers: ["Control"] });
  await expect(page).toHaveURL(/Note%20C/);

  await typeInEditor(page, "content");
  await expect(page.locator("footer")).toContainText("Synced");

  await page.getByLabel("Toggle backlinks panel").click();
  await expect(page.locator("aside").filter({ hasText: "Backlinks" })).toBeVisible();

  // Indexing + link backfill happens on the write-behind flush (~2s idle).
  await expect(async () => {
    const res = await page.request.get("/api/backlinks/Note%20C.md");
    const hits = (await res.json()) as { source_path: string }[];
    expect(hits.length).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });

  // The panel re-fetches on note:open/editor:ready; reopen it to refresh.
  await page.getByLabel("Toggle backlinks panel").click();
  await page.getByLabel("Toggle backlinks panel").click();
  await expect(page.locator("aside").filter({ hasText: "Backlinks" })).not.toContainText("No notes link here yet.");
});

test("tags: #tag chips in the editor, sidebar panel, and /tag view", async ({
  page,
}) => {
  await page.goto("/");
  await createNote(page);
  await typeInEditor(page, "Tagged with #project-x");
  await page.keyboard.press("Enter");

  const tagChip = page.locator(".cm-tag", { hasText: "#project-x" });
  await expect(tagChip).toBeVisible();
  await expect(page.locator("footer")).toContainText("Synced");

  // Indexing happens on the write-behind flush (~2s idle).
  await expect(async () => {
    const res = await page.request.get("/api/tags");
    const tags = (await res.json()) as { tag: string }[];
    expect(tags.some((t) => t.tag === "project-x")).toBe(true);
  }).toPass({ timeout: 15_000 });

  // The Tags panel starts collapsed and mounts (fetching the tag list) on
  // first expand — by now the tag is indexed, so expanding shows it.
  const tagsButton = page.getByRole("button", { name: "Tags", exact: true });
  await tagsButton.click();
  const chip = page.locator(".notable-tags-chip", { hasText: "project-x" });
  await expect(chip).toBeVisible();
  await chip.click();

  await expect(page).toHaveURL(/\/tag\/project-x/);
  await expect(page.locator("h1")).toContainText("project-x");
  await page.locator("main li button").first().click();
  await expect(page).toHaveURL(/\/note\//);
});

test("live preview hides markdown marks and renders task checkboxes", async ({
  page,
}) => {
  await page.goto("/");
  await createNote(page);
  await typeInEditor(page, "**bold**");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");

  await expect(page.locator(".cm-hl-strong")).toHaveText("bold");
  await expect(page.locator(".cm-content")).not.toContainText("**");

  await typeInEditor(page, "- [ ] buy milk");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");

  const checkbox = page.locator(".cm-task-checkbox");
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
});

test("soft-delete moves a note to .trash/, and it can be restored or purged", async ({
  page,
}) => {
  await page.goto("/");
  const notePath = await createNote(page);
  await typeInEditor(page, "trash me");
  await page.keyboard.press("Escape");
  await expect(page.locator("footer")).toContainText("Synced");

  const noteName = notePath.replace(/\.md$/, "");

  // Delete via the sidebar context menu — soft delete, not gone for good.
  await page
    .locator("nav")
    .getByRole("button", { name: noteName, exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete note" }).click();
  await page.getByRole("button", { name: "Delete" }).click();

  await expect(page.locator("nav")).not.toContainText(noteName);
  await expect(page).toHaveURL("/");

  await expect(async () => {
    expect(fs.existsSync(path.join(VAULT, ".trash", notePath))).toBe(true);
  }).toPass({ timeout: 5_000 });
  expect(fs.existsSync(path.join(VAULT, notePath))).toBe(false);

  // Trash view lists it, with restore and delete-forever actions.
  await page.getByRole("button", { name: "Trash" }).click();
  await expect(page).toHaveURL(/\/trash/);
  const trashRow = page.locator("li", { hasText: noteName });
  await expect(trashRow).toBeVisible();

  // Restore brings it back to the sidebar and off disk from .trash/.
  await trashRow.getByRole("button", { name: `Restore ${noteName}` }).click();
  await expect(trashRow).not.toBeVisible();
  await expect(async () => {
    expect(fs.existsSync(path.join(VAULT, notePath))).toBe(true);
    expect(fs.existsSync(path.join(VAULT, ".trash", notePath))).toBe(false);
  }).toPass({ timeout: 5_000 });
  await expect(page.locator("nav")).toContainText(noteName);

  // Trash it again, then permanently delete it from the trash view.
  await page
    .locator("nav")
    .getByRole("button", { name: noteName, exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete note" }).click();
  await page.getByRole("button", { name: "Delete" }).click();

  await page.getByRole("button", { name: "Trash" }).click();
  const trashRow2 = page.locator("li", { hasText: noteName });
  await expect(trashRow2).toBeVisible();
  await trashRow2.getByRole("button", { name: `Delete ${noteName} forever` }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(trashRow2).not.toBeVisible();

  await expect(async () => {
    expect(fs.existsSync(path.join(VAULT, ".trash", notePath))).toBe(false);
  }).toPass({ timeout: 5_000 });
});

test("custom theme picker injects a stylesheet link and updates colors", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Settings").click();
  await expect(page.getByRole("dialog")).toContainText("Custom theme");

  const before = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
  );

  await page.getByRole("dialog").getByRole("button", { name: "Nord" }).click();
  await expect(page.locator("#notable-custom-theme")).toHaveAttribute(
    "href",
    "/api/themes/nord.css",
  );
  await expect(async () => {
    const after = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim(),
    );
    expect(after).not.toBe(before);
  }).toPass({ timeout: 5_000 });
  const themedBackground = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--background")
      .trim(),
  );

  // A persisted pre-paint link must still override the app stylesheet.
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--background")
          .trim(),
      ),
    )
    .toBe(themedBackground);

  // "None" removes the injected stylesheet again.
  await page.getByLabel("Settings").click();
  await page.getByRole("dialog").getByRole("button", { name: "None" }).click();
  await expect(page.locator("#notable-custom-theme")).toHaveCount(0);
});

test("/new creates a note and redirects into it (app-shortcut target)", async ({
  page,
}) => {
  await page.goto("/new");
  await expect(page).toHaveURL(/\/note\//);
  await expect(page.locator(".cm-content")).toBeVisible();
});

test("/share-target creates a note from shared text and url", async ({ page }) => {
  await page.goto(
    "/share-target?title=Shared+page&text=Worth+a+read&url=https%3A%2F%2Fexample.com%2F",
  );
  await expect(page).toHaveURL(/\/note\//);
  await expect(page.locator("nav")).toContainText("Shared page");
  await expect(page.locator(".cm-content")).toContainText("# Shared page");
  await expect(page.locator(".cm-content")).toContainText("Worth a read");
  await expect(page.locator(".cm-content")).toContainText("https://example.com/");
});
