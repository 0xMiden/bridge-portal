import { test, expect } from "../../fixtures/bridge";

// WCAG 44px minimum tap target, minus a sub-pixel tolerance: getBoundingClientRect
// can return e.g. 43.99997 for a 44px element under the runner's device-pixel
// rounding, which is compliant but trips a strict `>= 44`.
const MIN_TAP_TARGET = 43.5;

type Rect = { top: number; right: number; bottom: number; left: number };

function intersects(a: Rect, b: Rect) {
  return !(
    a.bottom <= b.top ||
    a.top >= b.bottom ||
    a.right <= b.left ||
    a.left >= b.right
  );
}

for (const width of [640, 641]) {
  test(`${width}px uses an inline provider disclosure with accessible controls`, async ({ bridge, page }) => {
    await page.setViewportSize({ width, height: 900 });
    await bridge.fillAmount("1");
    await bridge.routeTrigger().click();
    await expect(bridge.providerOptions()).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await bridge.routeTrigger().boundingBox())?.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    await expect(page.locator("body")).not.toHaveAttribute("data-overlay-open", "true");
    await bridge.providerOptions().getByRole("button").first().focus();
    await page.keyboard.press("Escape");
    await expect(bridge.providerOptions()).toBeHidden();
    await expect(bridge.routeTrigger()).toBeFocused();
  });
}

test.describe("mobile bridge layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("wallet controls stay inside each transfer panel without collisions", async ({ bridge, page }) => {
    await bridge.waitForReady();
    for (const mode of ["Receive", "Send"] as const) {
      await bridge.setMode(mode);
      const panels = await page.locator(".swap-box").evaluateAll((elements) => elements.map((panel) => {
        const rect = (element: Element) => {
          const { top, right, bottom, left } = element.getBoundingClientRect();
          return { top, right, bottom, left };
        };
        return { panel: rect(panel), wallet: rect(panel.querySelector(".wallet-button")!), chain: rect(panel.querySelector(".swap-box-head")!) };
      }));
      expect(panels).toHaveLength(2);
      for (const { panel, wallet, chain } of panels) {
        expect(wallet.right).toBeLessThanOrEqual(panel.right);
        expect(wallet.left).toBeGreaterThanOrEqual(panel.left);
        expect(wallet.top).toBeGreaterThanOrEqual(panel.top);
        expect(wallet.bottom).toBeLessThanOrEqual(panel.bottom);
        expect(intersects(wallet, chain)).toBe(false);
      }
    }
  });

  test("mobile menu and review controls expose 44px targets", async ({
    bridge,
    page,
  }) => {
    await bridge.waitForReady();

    await page.locator('.panel-wallet[data-wallet="evm"] .wallet-button').first().click();
    const walletItems = page.locator(".wallet-actions-menu.open .wallet-menu-item");
    await expect(walletItems.first()).toBeVisible();
    for (let index = 0; index < (await walletItems.count()); index += 1) {
      await expect
        .poll(async () => (await walletItems.nth(index).boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    }
    await page.keyboard.press("Escape");

    await bridge.fillAmount("1");
    await bridge.routeTrigger().click();
    const routeOptions = bridge.providerOptions().getByRole("button");
    for (let index = 0; index < (await routeOptions.count()); index += 1) {
      const box = await routeOptions.nth(index).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    }
    await bridge.routeTrigger().click();

    await bridge.fillAmount("0.05");
    await bridge.openPreflight();
    for (const control of [
      page.locator(".preflight-close"),
      page.locator(".preflight-cancel"),
      page.locator(".preflight-confirm"),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
      expect(box?.width).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    }
  });

  test("sticky action dock stays collision-free with a visible form error", async ({
    bridge,
    page,
  }) => {
    await bridge.waitForReady();
    await bridge.setRoute("USDCx");
    await bridge.setMode("Receive");
    await bridge.setChain("Arc Testnet");
    await page.evaluate(() => localStorage.setItem("e2e-signer-mode", "reject"));
    await bridge.fillAmount("0.05");
    await bridge.openPreflight();
    await bridge.confirmPreflight();
    const formError = page.locator(".swap-card > .form-error");
    await expect(formError).toContainText(/cancelled/i);

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
