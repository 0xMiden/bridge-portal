import { expect, test } from "../../fixtures/bridge";

test("theme choice is keyboard accessible, persistent, and system-aware", async ({
  bridge,
  page,
}) => {
  await bridge.waitForReady();

  const trigger = page.getByRole("button", { name: "Theme: System" });
  const root = page.locator("html");

  await expect(trigger).toBeVisible();

  await trigger.focus();
  await trigger.press("Enter");

  const menu = page.getByRole("menu", { name: "Theme" });
  const light = menu.getByRole("menuitemradio", { name: "Light" });
  const dark = menu.getByRole("menuitemradio", { name: "Dark" });
  const system = menu.getByRole("menuitemradio", { name: "System" });

  await expect(menu).toBeVisible();
  await expect(system).toBeFocused();
  await system.press("ArrowDown");
  await expect(light).toBeFocused();
  await light.press("ArrowDown");
  await expect(dark).toBeFocused();
  await dark.press("Enter");

  await expect(root).toHaveClass(/\bdark\b/);
  await expect(page.getByRole("button", { name: "Theme: Dark" })).toBeFocused();

  await page.reload();
  await bridge.waitForReady();
  await expect(page.getByRole("button", { name: "Theme: Dark" })).toBeVisible();
  await expect(root).toHaveClass(/\bdark\b/);

  const persistedTrigger = page.getByRole("button", { name: "Theme: Dark" });
  await persistedTrigger.press("Enter");
  await expect(dark).toBeFocused();
  await dark.press("ArrowUp");
  await expect(light).toBeFocused();
  await light.press("Space");

  await expect(root).not.toHaveClass(/\bdark\b/);
  await expect(page.getByRole("button", { name: "Theme: Light" })).toBeFocused();

  await page.emulateMedia({ colorScheme: "dark" });
  const lightTrigger = page.getByRole("button", { name: "Theme: Light" });
  await lightTrigger.press("Enter");
  await expect(light).toBeFocused();
  await light.press("ArrowUp");
  await expect(system).toBeFocused();
  await system.press("Space");

  const systemTrigger = page.getByRole("button", { name: "Theme: System" });
  await systemTrigger.press("Enter");
  await expect(system).toHaveAttribute("aria-checked", "true");
  await expect(root).toHaveClass(/\bdark\b/);

  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).not.toHaveClass(/\bdark\b/);

  await system.press("Escape");
  await expect(menu).toBeHidden();
  await expect(systemTrigger).toBeFocused();

  await systemTrigger.press("Enter");
  await page.locator(".swap-card h1").click();
  await expect(menu).toBeHidden();
  await expect(systemTrigger).toBeFocused();
});
