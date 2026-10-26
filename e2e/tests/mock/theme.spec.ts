import { expect, test } from "../../fixtures/bridge";

type Rgba = { red: number; green: number; blue: number; alpha: number };

function parseColor(value: string): Rgba {
  const channels = value.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) {
    throw new Error(`Unsupported computed color: ${value}`);
  }
  return {
    red: channels[0],
    green: channels[1],
    blue: channels[2],
    alpha: channels[3] ?? 1,
  };
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  const channel = (front: number, back: number) =>
    (front * foreground.alpha + back * background.alpha * (1 - foreground.alpha)) /
    alpha;
  return {
    red: channel(foreground.red, background.red),
    green: channel(foreground.green, background.green),
    blue: channel(foreground.blue, background.blue),
    alpha,
  };
}

function contrastRatio(
  foreground: string,
  background: string,
  backdrop: string,
) {
  const backdropColor = parseColor(backdrop);
  const backgroundColor = composite(parseColor(background), backdropColor);
  const foregroundColor = composite(parseColor(foreground), backgroundColor);
  const luminance = ({ red, green, blue }: Rgba) => {
    const linear = (channel: number) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    };
    return (
      0.2126 * linear(red) +
      0.7152 * linear(green) +
      0.0722 * linear(blue)
    );
  };
  const foregroundLuminance = luminance(foregroundColor);
  const backgroundLuminance = luminance(backgroundColor);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

for (const theme of ["Light", "Dark"] as const) {
  test(`${theme} bridge fields, providers and primary action remain readable`, async ({ bridge, page }, info) => {
    await bridge.fillAmount("1");
    await page.getByRole("button", { name: "Theme: System" }).click();
    await page.getByRole("menuitemradio", { name: theme, exact: true }).click();
    await bridge.routeTrigger().click();
    await expect(bridge.providerOptions()).toBeVisible();
    const samples = await page.evaluate(() => {
      const pairs = [
        [".swap-box input", ".swap-box"],
        [".balance-line", ".swap-box"],
        [".selected-provider", ".transfer-route-card"],
        [".route-trigger", ".transfer-route-card"],
        [".route-tag.testnet", ".provider-option"],
        [".provider-costs", ".provider-option"],
        [".primary-action-dock .primary-button", ".primary-action-dock .primary-button"],
      ];
      return pairs.map(([textSelector, surfaceSelector]) => {
        const text = getComputedStyle(document.querySelector(textSelector)!);
        const surface = getComputedStyle(document.querySelector(surfaceSelector)!);
        return { textSelector, foreground: text.color, background: surface.backgroundColor,
          backdrop: getComputedStyle(document.querySelector(".swap-card")!).backgroundColor };
      });
    });
    for (const sample of samples) {
      expect(contrastRatio(sample.foreground, sample.background, sample.backdrop), sample.textSelector).toBeGreaterThanOrEqual(4.5);
    }
    await bridge.routeTrigger().click();
    await page.screenshot({ path: info.outputPath(`bridge-${theme.toLowerCase()}.png`), fullPage: true, animations: "disabled" });
  });
}

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
  await system.press("ArrowRight");
  await expect(light).toBeFocused();
  await light.press("ArrowLeft");
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
  await page.getByRole("tab", { name: "Bridge", exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(systemTrigger).toBeFocused();
});
