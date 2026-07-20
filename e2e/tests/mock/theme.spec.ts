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

test("dark route and status states use semantic contrast", async ({
  bridge,
  page,
}) => {
  await bridge.waitForReady();

  await page.getByRole("button", { name: "Theme: System" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await page.locator(".route-trigger").click();

  const testnetTag = page.locator(".route-tag.testnet").first();
  const disabledTag = page.locator(".route-tag.availability.off");

  await expect(testnetTag).toBeVisible();
  await expect(disabledTag).toBeVisible();

  await page.evaluate(() => {
    const states = document.createElement("div");
    states.id = "e2e-status-states";
    states.innerHTML = `
      <div class="route-disclaimer mock">Warning route</div>
      <span class="status-badge success">Success</span>
      <span class="status-badge warning">Warning</span>
      <span class="status-badge danger">Danger</span>
      <span class="status-badge active">Active</span>
    `;
    document.body.append(states);
  });

  await expect(
    page.locator("#e2e-status-states .route-disclaimer.mock"),
  ).toBeVisible();
  const statusStates = page.locator("#e2e-status-states .status-badge");
  await expect(statusStates).toHaveCount(4);
  for (const status of await statusStates.all()) {
    await expect(status).toBeVisible();
  }

  const stateStyles = await page.evaluate(() => {
    const rootStyles = getComputedStyle(document.documentElement);
    const resolvedToken = (token: string) => {
      if (!rootStyles.getPropertyValue(token).trim()) return "";
      const probe = document.createElement("span");
      probe.style.color = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const resolvedStyles = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing element: ${selector}`);
      }
      const styles = getComputedStyle(element);
      return {
        background: styles.backgroundColor,
        foreground: styles.color,
        border: styles.borderTopColor,
      };
    };

    return {
      tokens: {
        surface: resolvedToken("--surface"),
        surfaceMuted: resolvedToken("--surface-muted"),
        accentSoft: resolvedToken("--accent-soft"),
        accentBorder: resolvedToken("--accent-border"),
        accentForeground: resolvedToken("--accent-foreground"),
        successSoft: resolvedToken("--success-soft"),
        successBorder: resolvedToken("--success-border"),
        successForeground: resolvedToken("--success-foreground"),
        warningSoft: resolvedToken("--warning-soft"),
        warningBorder: resolvedToken("--warning-border"),
        warningForeground: resolvedToken("--warning-foreground"),
        dangerSoft: resolvedToken("--danger-soft"),
        dangerBorder: resolvedToken("--danger-border"),
        dangerForeground: resolvedToken("--danger-foreground"),
      },
      testnet: resolvedStyles(".route-tag.testnet"),
      disabled: resolvedStyles(".route-tag.availability.off"),
      warning: resolvedStyles(".route-disclaimer.mock"),
      success: resolvedStyles("#e2e-status-states .status-badge.success"),
      statusWarning: resolvedStyles(
        "#e2e-status-states .status-badge.warning",
      ),
      danger: resolvedStyles("#e2e-status-states .status-badge.danger"),
      active: resolvedStyles("#e2e-status-states .status-badge.active"),
    };
  });

  for (const token of Object.values(stateStyles.tokens)) {
    expect(token).not.toBe("");
  }

  expect(stateStyles.testnet.background).toBe(stateStyles.tokens.accentSoft);
  expect(stateStyles.testnet.foreground).toBe(
    stateStyles.tokens.accentForeground,
  );
  expect(stateStyles.disabled.background).toBe(stateStyles.tokens.surfaceMuted);
  expect(stateStyles.warning).toEqual({
    background: stateStyles.tokens.warningSoft,
    foreground: stateStyles.tokens.warningForeground,
    border: stateStyles.tokens.warningBorder,
  });
  expect(stateStyles.success).toEqual({
    background: stateStyles.tokens.successSoft,
    foreground: stateStyles.tokens.successForeground,
    border: stateStyles.tokens.successBorder,
  });
  expect(stateStyles.statusWarning).toEqual({
    background: stateStyles.tokens.warningSoft,
    foreground: stateStyles.tokens.warningForeground,
    border: stateStyles.tokens.warningBorder,
  });
  expect(stateStyles.danger).toEqual({
    background: stateStyles.tokens.dangerSoft,
    foreground: stateStyles.tokens.dangerForeground,
    border: stateStyles.tokens.dangerBorder,
  });
  expect(stateStyles.active).toEqual({
    background: stateStyles.tokens.accentSoft,
    foreground: stateStyles.tokens.accentForeground,
    border: stateStyles.tokens.accentBorder,
  });

  for (const state of [
    stateStyles.testnet,
    stateStyles.disabled,
    stateStyles.warning,
    stateStyles.success,
    stateStyles.statusWarning,
    stateStyles.danger,
    stateStyles.active,
  ]) {
    expect(state.foreground).not.toBe(state.background);
    expect(
      contrastRatio(
        state.foreground,
        state.background,
        stateStyles.tokens.surface,
      ),
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test("dark mode applies semantic bridge surfaces and primary contrast", async ({
  bridge,
  page,
}) => {
  await bridge.waitForReady();

  await page.getByRole("button", { name: "Theme: System" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  const colors = await page.evaluate(() => {
    const resolvedToken = (token: string) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const resolvedStyles = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing element: ${selector}`);
      }
      const styles = getComputedStyle(element);
      return {
        background: styles.backgroundColor,
        foreground: styles.color,
      };
    };

    return {
      tokens: {
        background: resolvedToken("--background"),
        surface: resolvedToken("--surface"),
        surfaceElevated: resolvedToken("--surface-elevated"),
        surfaceMuted: resolvedToken("--surface-muted"),
        surfaceStrong: resolvedToken("--surface-strong"),
        foreground: resolvedToken("--foreground"),
        mutedForeground: resolvedToken("--muted-foreground"),
        faintForeground: resolvedToken("--faint-foreground"),
        border: resolvedToken("--border"),
        borderStrong: resolvedToken("--border-strong"),
        primary: resolvedToken("--primary"),
        primaryForeground: resolvedToken("--primary-foreground"),
        accent: resolvedToken("--accent"),
      },
      card: resolvedStyles(".swap-card"),
      routeControl: resolvedStyles(".route-trigger"),
      walletMenu: resolvedStyles(".wallet-actions-menu"),
      primaryButton: resolvedStyles(".swap-card > .primary-button"),
    };
  });

  expect(colors.tokens).toEqual({
    background: "rgb(13, 18, 16)",
    surface: "rgb(20, 27, 24)",
    surfaceElevated: "rgb(25, 33, 30)",
    surfaceMuted: "rgb(27, 37, 33)",
    surfaceStrong: "rgb(36, 48, 43)",
    foreground: "rgb(241, 246, 243)",
    mutedForeground: "rgb(161, 176, 168)",
    faintForeground: "rgb(113, 128, 120)",
    border: "rgba(241, 246, 243, 0.12)",
    borderStrong: "rgba(241, 246, 243, 0.21)",
    primary: "rgb(241, 246, 243)",
    primaryForeground: "rgb(13, 18, 16)",
    accent: "rgb(255, 106, 42)",
  });
  expect(colors.card.background).toBe(colors.tokens.surface);
  expect(colors.routeControl.background).toBe(colors.tokens.surface);
  expect(colors.walletMenu.background).toBe(colors.tokens.surfaceElevated);
  expect(colors.primaryButton.background).toBe(colors.tokens.primary);
  expect(colors.primaryButton.foreground).toBe(colors.tokens.primaryForeground);
  expect(colors.primaryButton.foreground).not.toBe(
    colors.primaryButton.background,
  );

  await page.getByRole("button", { name: "Theme: Dark" }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

  const lightTokens = await page.evaluate(() => {
    const names = [
      "background",
      "surface",
      "surface-muted",
      "surface-strong",
      "foreground",
      "muted-foreground",
      "faint-foreground",
      "border",
      "border-strong",
      "primary",
      "primary-foreground",
      "accent",
    ];

    return names.map((name) => {
      const probe = document.createElement("span");
      probe.style.color = `var(--${name})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
  });

  expect(lightTokens).toEqual([
    "rgb(244, 247, 245)",
    "rgb(255, 255, 255)",
    "rgb(237, 243, 240)",
    "rgb(226, 236, 231)",
    "rgb(23, 32, 28)",
    "rgb(96, 112, 105)",
    "rgb(137, 149, 143)",
    "rgba(23, 32, 28, 0.11)",
    "rgba(23, 32, 28, 0.19)",
    "rgb(23, 32, 28)",
    "rgb(255, 255, 255)",
    "rgb(255, 85, 0)",
  ]);
});

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
