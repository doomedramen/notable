import { expect, test } from "@playwright/test";

test("debug drag", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.getByRole("dialog", { name: "Sidebar" });
  await page.getByLabel("Open sidebar").click();
  await expect(sidebar).toBeInViewport();
  await page.getByLabel("New…").click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  const folder = `Touch drop ${Date.now()}`;
  await page.getByLabel("Folder name").fill(folder);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(sidebar).toBeInViewport();

  await page.getByLabel("New…").click();
  await page.getByRole("menuitem", { name: "New note" }).click();
  await expect(page).toHaveURL(/\/note\//);
  await expect(page.getByRole("dialog", { name: "Rename note" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  const noteName = decodeURIComponent(new URL(page.url()).pathname.replace(/^\/note\//, "")).replace(/\.md$/, "").split("/").pop()!;

  await page.getByLabel("Open sidebar").click();
  await expect(sidebar).toBeInViewport();

  const row = sidebar.getByRole("button", { name: noteName, exact: true });
  const target = sidebar.getByRole("button", { name: folder, exact: true });
  const rowBox = (await row.boundingBox())!;
  const targetBox = (await target.boundingBox())!;
  console.log("rowBox", rowBox, "targetBox", targetBox);

  const client = await page.context().newCDPSession(page);
  const x1 = rowBox.x + rowBox.width / 2;
  const y1 = rowBox.y + rowBox.height / 2;
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y: y1 }] });
  await page.waitForTimeout(320);
  const x2 = targetBox.x + targetBox.width / 2;
  const y2 = targetBox.y + targetBox.height / 2;
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps }],
    });
    await page.waitForTimeout(50);
  }
  await page.screenshot({ path: "/tmp/drag.png" });
  console.log("dragOverFolder html", await row.getAttribute("class"));
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
  await page.waitForTimeout(300);
  console.log("url", page.url());
});
