import { expect, test } from "@playwright/test";

test("create a note, type, persist across reload", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("New note").click();
  await expect(page).toHaveURL(/\/note\//);

  await page.locator(".cm-content").click();
  await page.keyboard.type("# Smoke test");
  await page.keyboard.press("Enter");
  await page.keyboard.type("hello world");
  await expect(page.locator("footer")).toContainText("Synced");

  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("hello world");
  // Sidebar shows the note too.
  await expect(page.locator("nav")).toContainText("Untitled");
});

test("offline edits are flagged and recover on reconnect", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByLabel("New note").click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("first line");
  await expect(page.locator("footer")).toContainText("Synced");

  await context.setOffline(true);
  await page.keyboard.type(" — offline edit");
  await expect(page.locator("footer")).toContainText("Offline");

  await context.setOffline(false);
  await expect(page.locator("footer")).toContainText("Synced", {
    timeout: 15_000,
  });
});
