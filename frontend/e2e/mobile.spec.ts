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

  // The editor surfaces the open note's name (the top bar stays minimal:
  // drawer toggle + search only).
  await expect(
    page.getByRole("heading", { name: "Untitled" }),
  ).toBeVisible();
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

/** Dispatch a synthetic horizontal swipe from (x1,y) to (x2,y). */
async function swipe(page: import("@playwright/test").Page, x1: number, x2: number, y = 300) {
  await page.evaluate(
    ([from, to, yPos]) => {
      const target = document.querySelector('[data-testid="mobile-top-bar"]')!;
      const touch = (x: number) =>
        new Touch({ identifier: 1, target, clientX: x, clientY: yPos });
      target.dispatchEvent(
        new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch(from)] }),
      );
      target.dispatchEvent(
        new TouchEvent("touchend", {
          bubbles: true,
          cancelable: true,
          changedTouches: [touch(to)],
        }),
      );
    },
    [x1, x2, y],
  );
}

test("edge swipe opens the drawer, swipe left closes it", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.getByTestId("sidebar");
  await expect(sidebar).not.toBeInViewport();

  // Swipe right starting near the left edge -> opens the drawer.
  await swipe(page, 5, 200);
  await expect(sidebar).toBeInViewport();

  // Swipe left anywhere -> closes the drawer.
  await swipe(page, 250, 50);
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
