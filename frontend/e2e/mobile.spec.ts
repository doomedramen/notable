import { expect, test } from "@playwright/test";

/* Mobile-first behavior: the sidebar is an off-canvas drawer, the top
   bar provides drawer + palette access, and navigation closes the
   drawer to reveal the editor. Runs under the "mobile" project
   (iPhone-ish viewport, touch). */

test("sidebar is a drawer: closed on load, opens, closes on navigation", async ({
  page,
}) => {
  await page.goto("/");

  // Drawer starts closed on small screens; the top bar is visible.
  const sidebar = page.getByTestId("sidebar");
  const topBar = page.getByTestId("mobile-top-bar");
  await expect(topBar).toBeVisible();
  await expect(sidebar).not.toBeInViewport();

  // Hamburger opens the drawer.
  await page.getByLabel("Open sidebar").click();
  await expect(sidebar).toBeInViewport();

  // Creating a note navigates to it — drawer must close to reveal it.
  await page.getByLabel("New…").click();
  await page.getByRole("menuitem", { name: "New note" }).click();
  await expect(page).toHaveURL(/\/note\//);
  await expect(sidebar).not.toBeInViewport();
  await expect(page.locator(".cm-content")).toBeVisible();

  // The top bar shows the open note's name.
  await expect(topBar).toContainText("Untitled");
});

test("top bar search button opens the command palette", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Search").click();
  await expect(
    page.getByPlaceholder("Search notes and commands…"),
  ).toBeVisible();
});

test("backdrop tap closes the drawer", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Open sidebar").click();
  const sidebar = page.getByTestId("sidebar");
  await expect(sidebar).toBeInViewport();

  // Tap the backdrop area right of the drawer.
  const viewport = page.viewportSize()!;
  await page.mouse.click(viewport.width - 10, viewport.height / 2);
  await expect(sidebar).not.toBeInViewport();
});

test("settings opens as a near-fullscreen sheet with tab strip", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Open sidebar").click();
  await page.getByLabel("Settings").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Appearance");
  await expect(dialog).toContainText("Plugins");

  // The sheet should use most of the viewport width on a phone.
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.width).toBeGreaterThan(viewport.width * 0.9);
});
