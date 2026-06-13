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
  const sidebar = page.getByRole("dialog", { name: "Sidebar" });
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
  const sidebar = page.getByRole("dialog", { name: "Sidebar" });
  await expect(sidebar).toBeInViewport();

  // Tap the backdrop area right of the drawer.
  const viewport = page.viewportSize()!;
  await page.mouse.click(viewport.width - 10, viewport.height / 2);
  await expect(sidebar).not.toBeInViewport();
});

/** Dispatch a synthetic horizontal drag swipe from (x1,y) to (x2,y).
    swipe-bar listens on `window` and only activates dragging once a
    touchmove crosses its ~20px activation threshold, so this dispatches
    a touchstart followed by several incremental touchmoves before the
    final touchend (a single touchstart+touchend jump is ignored). */
async function swipe(page: import("@playwright/test").Page, x1: number, x2: number, y = 300) {
  await page.evaluate(
    ([from, to, yPos]) => {
      const steps = 6;
      const touch = (x: number) =>
        new Touch({ identifier: 1, target: document.body, clientX: x, clientY: yPos });
      window.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          cancelable: true,
          touches: [touch(from)],
          changedTouches: [touch(from)],
        }),
      );
      for (let i = 1; i <= steps; i++) {
        const x = from + ((to - from) * i) / steps;
        window.dispatchEvent(
          new TouchEvent("touchmove", {
            bubbles: true,
            cancelable: true,
            touches: [touch(x)],
            changedTouches: [touch(x)],
          }),
        );
      }
      window.dispatchEvent(
        new TouchEvent("touchend", {
          bubbles: true,
          cancelable: true,
          touches: [],
          changedTouches: [touch(to)],
        }),
      );
    },
    [x1, x2, y],
  );
}

async function dragWithoutRelease(
  page: import("@playwright/test").Page,
  x1: number,
  x2: number,
  y = 300,
) {
  await page.evaluate(
    ([from, to, yPos]) => {
      const steps = 6;
      const touch = (x: number) =>
        new Touch({ identifier: 1, target: document.body, clientX: x, clientY: yPos });
      window.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          cancelable: true,
          touches: [touch(from)],
          changedTouches: [touch(from)],
        }),
      );
      for (let i = 1; i <= steps; i++) {
        const x = from + ((to - from) * i) / steps;
        window.dispatchEvent(
          new TouchEvent("touchmove", {
            bubbles: true,
            cancelable: true,
            touches: [touch(x)],
            changedTouches: [touch(x)],
          }),
        );
      }
    },
    [x1, x2, y],
  );
}

test("edge swipe opens the drawer, swipe left closes it", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.getByRole("dialog", { name: "Sidebar" });
  await expect(sidebar).not.toBeInViewport();

  // Swipe right starting near the left edge -> opens the drawer.
  await swipe(page, 5, 200);
  await expect(sidebar).toBeInViewport();

  // Swipe left anywhere -> closes the drawer.
  await swipe(page, 250, 50);
  await expect(sidebar).not.toBeInViewport();
});

test("swiping the drawer open does not trigger header tooltips", async ({
  page,
}) => {
  await page.goto("/");
  const sidebar = page.getByRole("dialog", { name: "Sidebar" });

  // Finish the drag where the Settings button lands. Moving drawer content
  // under a mouse-like pointer must not be interpreted as a desktop hover.
  await page.mouse.move(5, 28);
  await page.mouse.down();
  await page.mouse.move(184, 28, { steps: 6 });
  await page.mouse.up();

  await expect(sidebar).toBeInViewport();
  await page.waitForTimeout(450);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("edge swipe dims the page while the drawer is moving", async ({ page }) => {
  await page.goto("/");
  const backdrop = page.getByTestId("sidebar-swipe-backdrop");
  await expect(backdrop).toHaveCount(1);

  await dragWithoutRelease(page, 5, 150);
  const opacity = await backdrop.evaluate((element) =>
    Number(getComputedStyle(element).opacity),
  );
  expect(opacity).toBeGreaterThan(0);
  expect(opacity).toBeLessThan(1);

  await page.evaluate(() => {
    const touch = new Touch({
      identifier: 1,
      target: document.body,
      clientX: 150,
      clientY: 300,
    });
    window.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        cancelable: true,
        touches: [],
        changedTouches: [touch],
      }),
    );
  });
  await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeInViewport();
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
