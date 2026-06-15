import { expect, test, type Page } from "@playwright/test";

async function enableQuickNote(page: Page) {
  await page.getByLabel("Settings").click();
  await page.getByRole("dialog").getByRole("button", { name: "Plugins" }).click();
  await expect(page.getByRole("dialog")).toContainText("Quick note");
  await page.getByLabel("Enable Quick note").click();
  await page.keyboard.press("Escape");
}

test("debug full flow", async ({ page }) => {
  page.on("console", (msg) => console.log("CONSOLE:", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message, err.stack));
  page.on("response", (res) => {
    if (res.status() >= 400) console.log("HTTP", res.status(), res.url());
  });
  await page.goto("/");
  await enableQuickNote(page);

  await page.getByLabel("New…").click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  const folder = `Capture ${Date.now()}`;
  await page.getByLabel("Folder name").fill(folder);
  await page.getByRole("button", { name: "Create" }).click();

  await page.keyboard.press("ControlOrMeta+Alt+n");
  await page.waitForTimeout(1000);
  const html = await page.locator('[role="dialog"]').innerHTML();
  console.log("DIALOG HTML:", html.slice(0, 2000));
});
