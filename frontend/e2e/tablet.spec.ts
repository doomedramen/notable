import { expect, test } from "@playwright/test";

test("tablet layout keeps the sidebar and calm responsive density", async ({
  page,
}) => {
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
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
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
  const duration = await page
    .locator(".ui-view")
    .evaluate((element) => getComputedStyle(element).animationDuration);
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.01);
});
