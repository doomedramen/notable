import { expect, test } from "@playwright/test";

test("tablet layout keeps the sidebar and calm responsive density", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("complementary")).toBeVisible();
  await expect(page.getByTestId("mobile-top-bar")).not.toBeVisible();

  const background = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--background"),
  );
  expect(background.trim()).toBe("#fffdf9");
});

test("dark theme preserves readable host tokens", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitem", { name: "Dark" }).click();
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      background: style.getPropertyValue("--background").trim(),
      foreground: style.getPropertyValue("--foreground").trim(),
    };
  });
  expect(tokens).toEqual({
    background: "#1f1d1a",
    foreground: "#f1ece4",
  });
});

test("reduced motion removes structural animation time", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByLabel("Settings").click();
  const duration = await page
    .locator(".ui-dialog")
    .evaluate((element) => getComputedStyle(element).animationDuration);
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.01);
});

test("routine synced feedback recedes while warnings remain visible", async ({ page, context }) => {
  await page.goto("/");
  await page.getByLabel("New…").click();
  await page.getByRole("menuitem", { name: "New note" }).click();
  await page.getByRole("button", { name: "Save note" }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  const indicator = page.getByTestId("sync-indicator");
  await expect(indicator).toHaveAttribute("data-receded", "false");
  await expect(indicator).toHaveAttribute("data-receded", "true", {
    timeout: 5000,
  });

  await context.setOffline(true);
  await page.locator(".cm-content").click();
  await page.keyboard.type("offline warning");
  await expect(indicator).toContainText("Offline");
  await expect(indicator).toHaveAttribute("data-receded", "false");
  await context.setOffline(false);
});
