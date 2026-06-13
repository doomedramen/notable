import {
  expect,
  test,
  type CDPSession,
  type Page,
} from "@playwright/test";

const MOBILE_DRAWER_WIDTH = 288;

async function mockHaptics(page: Page) {
  await page.addInitScript(() => {
    const target = window as Window & { __hapticCalls?: unknown[] };
    target.__hapticCalls = [];
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: unknown) => {
        target.__hapticCalls?.push(pattern);
        return true;
      },
    });
  });
}

async function hapticCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      ((window as Window & { __hapticCalls?: unknown[] }).__hapticCalls ?? [])
        .length,
  );
}

async function clearHaptics(page: Page) {
  await page.evaluate(() => {
    (window as Window & { __hapticCalls?: unknown[] }).__hapticCalls = [];
  });
}

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
  await expect(page.getByRole("dialog", { name: "Quick Note" })).toBeVisible();
  await page.getByRole("button", { name: "Save note" }).click();
  await page.getByRole("button", { name: "Untitled" }).click();
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

test("footer sits flush with the viewport bottom", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("footer");
  const viewport = page.viewportSize()!;
  const box = (await footer.boundingBox())!;

  expect(box.y + box.height).toBe(viewport.height);
  await expect(footer).toHaveCSS("margin-bottom", "0px");
  await expect(footer).toHaveCSS("padding-bottom", "0px");
});

test("mobile Quick Note button is a 48px touch target", async ({ page }) => {
  await page.goto("/");
  const floating = page.locator('button.fixed[aria-label="Quick note"]');
  const box = (await floating.boundingBox())!;
  expect(box.width).toBe(48);
  expect(box.height).toBe(48);
});

test("touch Quick Note capture emits impact then success feedback", async ({
  page,
}) => {
  await mockHaptics(page);
  await page.goto("/");

  await page.getByLabel("Quick note").tap();
  await expect(page.getByRole("dialog", { name: "Quick Note" })).toBeVisible();
  expect(await hapticCount(page)).toBe(1);

  await page.getByLabel("Quick note content").fill("Tactile capture");
  await page.getByRole("button", { name: "Save note" }).tap();
  await expect(page.getByText("Note captured.")).toBeVisible();
  expect(await hapticCount(page)).toBe(2);
});

test("touch Quick Note save errors emit one error pattern", async ({ page }) => {
  await mockHaptics(page);
  await page.route("**/api/notes", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 500, body: "failed" });
    } else {
      await route.continue();
    }
  });
  await page.goto("/");
  await page.getByLabel("Quick note").tap();
  await page.getByLabel("Quick note content").fill("Will fail");
  await clearHaptics(page);

  await page.getByRole("button", { name: "Save note" }).tap();

  await expect(page.getByText("Could not save the note.")).toBeVisible();
  expect(await hapticCount(page)).toBe(1);
});

test("haptic preference persists and suppresses touch feedback", async ({
  page,
}) => {
  await mockHaptics(page);
  await page.goto("/");
  await page.getByLabel("Open sidebar").click();
  await page.getByLabel("Settings").click();
  const toggle = page.getByRole("switch", { name: "Haptic feedback" });
  await expect(toggle).toBeChecked();
  await toggle.tap();
  await expect(toggle).not.toBeChecked();

  await page.reload();
  await page.getByLabel("Open sidebar").click();
  await page.getByLabel("Settings").click();
  await expect(
    page.getByRole("switch", { name: "Haptic feedback" }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  await clearHaptics(page);

  await page.getByLabel("Quick note").tap();
  expect(await hapticCount(page)).toBe(0);
});

test("plugin status moves into a menu only when it runs out of room", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("status-bar-overflow")).toHaveCount(0);

  await page.setViewportSize({ width: 180, height: 844 });
  const overflow = page.getByTestId("status-bar-overflow");
  await expect(overflow).toBeVisible();
  await expect(page.getByTestId("status-bar-inline-items")).toBeHidden();

  await overflow.click();
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("Backlinks");
  await expect(menu).toContainText("0 words");
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

  await page.getByLabel("Open sidebar").click();
  await expect(sidebar).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(sidebar).not.toBeInViewport();
});

async function startTouchDrag(
  page: Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: x1, y: y1 }],
  });
  const steps = 6;
  for (let index = 1; index <= steps; index += 1) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: x1 + ((x2 - x1) * index) / steps,
          y: y1 + ((y2 - y1) * index) / steps,
        },
      ],
    });
  }
  return client;
}

async function endTouchDrag(client: CDPSession) {
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await client.detach();
}

async function touchDrag(
  page: Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const client = await startTouchDrag(page, x1, y1, x2, y2);
  await endTouchDrag(client);
}

async function swipe(page: Page, x1: number, x2: number, y = 300) {
  await touchDrag(page, x1, y, x2, y);
}

async function dragWithoutRelease(
  page: Page,
  x1: number,
  x2: number,
  y = 300,
): Promise<CDPSession> {
  return startTouchDrag(page, x1, y, x2, y);
}

test("edge swipe opens the drawer, swipe left closes it", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.getByRole("dialog", { name: "Sidebar" });
  await expect(sidebar).not.toBeInViewport();

  // Swipe right starting near the left edge -> opens the drawer.
  await swipe(page, 5, 200);
  await expect(sidebar).toBeInViewport();
  await expect
    .poll(async () => (await sidebar.boundingBox())?.x)
    .toBeCloseTo(0, 0);

  // Swipe left anywhere -> closes the drawer.
  await swipe(page, 250, 50);
  await expect(sidebar).not.toBeInViewport();
});

test("drawer commitment threshold emits feedback once", async ({ page }) => {
  await mockHaptics(page);
  await page.goto("/");

  await swipe(page, 5, 180);

  await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeInViewport();
  expect(await hapticCount(page)).toBe(1);
});

test("swiping the drawer open does not trigger header tooltips", async ({
  page,
}) => {
  await page.goto("/");
  const sidebar = page.getByRole("dialog", { name: "Sidebar" });

  // Drawer content moving under a touch gesture must not be interpreted as
  // a desktop hover. Stay below iOS's top-edge browser gesture region.
  await swipe(page, 5, 200, 100);

  await expect(sidebar).toBeInViewport();
  await page.waitForTimeout(450);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("edge swipe dims the page while the drawer is moving", async ({ page }) => {
  await page.goto("/");
  const backdrop = page.getByTestId("sidebar-swipe-backdrop");
  const sidebar = page.getByRole("dialog", { name: "Sidebar" });
  await expect(backdrop).toHaveCount(0);

  const client = await dragWithoutRelease(page, 5, 150);
  await expect(backdrop).toHaveCount(1);
  const sidebarBox = await sidebar.boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(sidebarBox!.x).toBeGreaterThan(-MOBILE_DRAWER_WIDTH + 20);
  expect(sidebarBox!.width).toBe(MOBILE_DRAWER_WIDTH);
  const opacity = await backdrop.evaluate((element) =>
    Number(getComputedStyle(element).opacity),
  );
  expect(opacity).toBeGreaterThan(0);
  expect(opacity).toBeLessThan(1);

  await endTouchDrag(client);
  await expect(sidebar).toBeInViewport();
});

test("short sidebar swipes cancel in both directions", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.getByRole("dialog", { name: "Sidebar" });

  let client = await dragWithoutRelease(page, 5, 70);
  await page.waitForTimeout(120);
  await endTouchDrag(client);
  await expect(sidebar).not.toBeInViewport();

  await page.getByLabel("Open sidebar").click();
  await expect(sidebar).toBeInViewport();
  client = await dragWithoutRelease(page, 250, 200);
  await page.waitForTimeout(120);
  await endTouchDrag(client);
  await expect(sidebar).toBeInViewport();
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

test("settings sheet can be dismissed with a downward drag", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Open sidebar").click();
  await page.getByLabel("Settings").click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const handle = page.getByTestId("settings-sheet-handle");
  const box = (await handle.boundingBox())!;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 180, { steps: 8 });
  await page.mouse.up();

  await expect(dialog).not.toBeVisible();
});

test("Quick Note sheet drag dismisses with one threshold pulse", async ({
  page,
}) => {
  await mockHaptics(page);
  await page.goto("/");
  await page.getByLabel("Quick note").tap();
  await clearHaptics(page);

  const handle = (await page.getByTestId("quick-note-sheet-handle").boundingBox())!;
  await touchDrag(
    page,
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
    handle.x + handle.width / 2,
    handle.y + 160,
  );

  await expect(page.getByRole("dialog", { name: "Quick Note" })).not.toBeVisible();
  expect(await hapticCount(page)).toBe(1);
});

test("settings gestures do not move the open sidebar", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Open sidebar").click();
  await page.getByLabel("Settings").click();

  const settings = page.getByRole("dialog", { name: "Settings" });
  const sidebar = page.getByTestId("mobile-sidebar");
  await expect(settings).toBeVisible();

  const tabs = (await page.getByTestId("settings-tabs").boundingBox())!;
  await touchDrag(
    page,
    tabs.x + tabs.width - 24,
    tabs.y + tabs.height / 2,
    tabs.x + 32,
    tabs.y + tabs.height / 2,
  );
  expect((await sidebar.boundingBox())!.x).toBeCloseTo(0, 0);

  const content = (await page.getByTestId("settings-content").boundingBox())!;
  await touchDrag(
    page,
    content.x + content.width / 2,
    content.y + Math.min(content.height - 20, 300),
    content.x + content.width / 2,
    content.y + 40,
  );
  expect((await sidebar.boundingBox())!.x).toBeCloseTo(0, 0);

  await settings.getByRole("button", { name: "Close" }).click();
  await expect(settings).not.toBeVisible();
  await expect
    .poll(async () => (await sidebar.boundingBox())?.x)
    .toBeCloseTo(0, 0);

  await swipe(page, 250, 50);
  await expect(sidebar).not.toBeInViewport();
});

test("edge swipe is ignored while settings is open", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Search").click();
  await page.getByPlaceholder("Search notes and commands…").fill("settings");
  await page.getByRole("option", { name: /Open settings/ }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();

  await swipe(page, 5, 200);
  await expect(page.getByTestId("mobile-sidebar")).toHaveCount(0);
});
