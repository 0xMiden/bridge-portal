import { test, expect } from "../../fixtures/bridge";

type Rect = { top: number; right: number; bottom: number; left: number };

function intersects(a: Rect, b: Rect) {
  return !(
    a.bottom <= b.top ||
    a.top >= b.bottom ||
    a.right <= b.left ||
    a.left >= b.right
  );
}

test.describe("route breakpoint behavior", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
  });

  test("640px uses mobile dialog semantics and 44px route controls", async ({
    bridge,
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await bridge.waitForReady();
    await bridge.routeTrigger().click();

    const dialog = bridge.routeDialog();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(page.locator(".route-sheet-backdrop")).toBeVisible();
    await expect(bridge.routeListbox()).toBeVisible();
    const triggerBox = await bridge.routeTrigger().boundingBox();
    expect(triggerBox?.height).toBeGreaterThanOrEqual(44);
    const options = bridge.routeListbox().getByRole("option");
    for (let index = 0; index < (await options.count()); index += 1) {
      const box = await options.nth(index).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("outside pointer close preserves focus on the clicked input", async ({
    bridge,
    page,
  }) => {
    await bridge.waitForReady();
    await bridge.routeTrigger().click();

    const destination = page.locator(".destination-input input");
    await destination.click();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );

    await expect(bridge.routeListbox()).toBeHidden();
    await expect(destination).toBeFocused();
  });
});

test.describe("mobile bridge layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("header uses a brand/theme row and two equal wallet tracks", async ({
    bridge,
    page,
  }) => {
    await bridge.waitForReady();

    const layout = await page.locator(".topbar").evaluate((topbar) => {
      const brand = topbar.querySelector(".brand")!.getBoundingClientRect();
      const theme = topbar
        .querySelector(".theme-menu-root")!
        .getBoundingClientRect();
      const wallets = Array.from(
        topbar.querySelectorAll(".wallet-cluster > *"),
      ).map((element) => element.getBoundingClientRect());
      return {
        brandTop: brand.top,
        themeTop: theme.top,
        brandBottom: brand.bottom,
        walletTops: wallets.map((rect) => rect.top),
        walletWidths: wallets.map((rect) => rect.width),
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    expect(Math.abs(layout.brandTop - layout.themeTop)).toBeLessThan(4);
    expect(Math.min(...layout.walletTops)).toBeGreaterThanOrEqual(
      layout.brandBottom,
    );
    expect(Math.abs(layout.walletWidths[0] - layout.walletWidths[1])).toBeLessThan(
      2,
    );
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  });

  test("route opens as a labelled bottom dialog and restores focus on Escape", async ({
    bridge,
    page,
  }) => {
    const trigger = bridge.routeTrigger();
    await trigger.click();

    const dialog = bridge.routeDialog();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(page.locator(".route-sheet-backdrop")).toBeVisible();
    await expect(bridge.routeListbox()).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-controls", "bridge-route-listbox");
    await expect(page.locator("body")).toHaveAttribute("data-overlay-open", "true");

    const geometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        position: getComputedStyle(element).position,
        left: rect.left,
        right: window.innerWidth - rect.right,
      };
    });
    expect(geometry.position).toBe("fixed");
    await expect
      .poll(() =>
        dialog.evaluate((element) =>
          Math.abs(window.innerHeight - element.getBoundingClientRect().bottom),
        ),
      )
      .toBeLessThanOrEqual(1);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeGreaterThanOrEqual(0);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.locator("body")).not.toHaveAttribute(
      "data-overlay-open",
      "true",
    );
  });

  test("route dialog traps focus and restores exact body scroll styles", async ({
    bridge,
    page,
  }) => {
    await page.evaluate(() => {
      document.body.style.overflow = "clip";
      document.body.style.position = "relative";
    });
    await bridge.routeTrigger().click();

    const dialog = bridge.routeDialog();
    const focusables = dialog.locator(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    await focusables.last().focus();
    await page.keyboard.press("Tab");
    await expect(focusables.first()).toBeFocused();

    await page.locator(".route-sheet-backdrop").click({ position: { x: 1, y: 1 } });
    await expect(dialog).toBeHidden();
    await expect(bridge.routeTrigger()).toBeFocused();
    await expect
      .poll(() =>
        page.evaluate(() => ({
          overflow: document.body.style.overflow,
          position: document.body.style.position,
        })),
      )
      .toEqual({ overflow: "clip", position: "relative" });
  });

  test("mobile menu and review controls expose 44px targets", async ({
    bridge,
    page,
  }) => {
    await bridge.waitForReady();

    await page.locator(".wallet-cluster .wallet-button").first().click();
    const walletItems = page.locator(".wallet-actions-menu.open .wallet-menu-item");
    await expect(walletItems.first()).toBeVisible();
    for (let index = 0; index < (await walletItems.count()); index += 1) {
      await expect
        .poll(async () => (await walletItems.nth(index).boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press("Escape");

    await bridge.routeTrigger().click();
    const routeOptions = bridge.routeListbox().getByRole("option");
    for (let index = 0; index < (await routeOptions.count()); index += 1) {
      const box = await routeOptions.nth(index).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press("Escape");

    await bridge.fillAmount("0.05");
    await bridge.openPreflight();
    for (const control of [
      page.locator(".preflight-close"),
      page.locator(".preflight-cancel"),
      page.locator(".preflight-confirm"),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("sticky action dock stays collision-free with a visible form error", async ({
    bridge,
    page,
  }) => {
    await bridge.waitForReady();
    await bridge.setRoute("AggLayer");
    await bridge.setMode("Send");
    await bridge.fillAmount("0.05");
    await bridge.fillDestination("not-a-sepolia-address");
    await bridge.openPreflight();
    await bridge.confirmPreflight();
    const formError = page.locator(".swap-card > .form-error");
    await expect(formError).toContainText(/valid Sepolia/i);

    const dock = bridge.actionDock();
    await expect(dock).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

    const boxes = await page.evaluate(() => {
      const rect = (selector: string) => {
        const box = document.querySelector(selector)!.getBoundingClientRect();
        return {
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          left: box.left,
        };
      };
      return {
        dock: rect(".primary-action-dock"),
        quote: rect(".quote-summary"),
        disclaimer: rect(".route-disclaimer"),
        error: rect(".swap-card > .form-error"),
        dockPosition: getComputedStyle(
          document.querySelector(".primary-action-dock")!,
        ).position,
        buttonPosition: getComputedStyle(
          document.querySelector(".primary-action-dock .primary-button")!,
        ).position,
        viewportHeight: window.innerHeight,
      };
    });

    expect(intersects(boxes.dock, boxes.quote)).toBe(false);
    expect(intersects(boxes.dock, boxes.disclaimer)).toBe(false);
    expect(intersects(boxes.dock, boxes.error)).toBe(false);
    expect(boxes.dockPosition).toBe("sticky");
    expect(boxes.dock.top).toBeGreaterThanOrEqual(0);
    expect(boxes.dock.bottom).toBeLessThanOrEqual(boxes.viewportHeight + 1);
    expect(boxes.buttonPosition).toBe("static");
  });

  for (const width of [360, 390]) {
    test(`${width}px viewport has no horizontal overflow`, async ({
      bridge,
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await bridge.waitForReady();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
    });
  }
});
