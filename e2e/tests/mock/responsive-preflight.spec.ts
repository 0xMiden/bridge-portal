import { expect, test } from "../../fixtures/bridge";
import type { BridgePage } from "../../pages/bridge-page";

const destination = "0x00000000000000000000000000000000000000ab";

async function openAgglayerReview(bridge: BridgePage) {
  await bridge.waitForReady();
  await bridge.setRoute("AggLayer");
  await bridge.setMode("Receive");
  await bridge.fillAmount("0.07");
  await bridge.fillDestination(destination);
  await bridge.openPreflight();
}

for (const width of [360, 390]) {
test(`mobile ${width}px review is a viewport bottom sheet with a contained keyboard flow`, async ({
  bridge,
  page,
}) => {
  await page.setViewportSize({ width, height: 844 });
  await openAgglayerReview(bridge);

  const overlay = bridge.preflight();
  const panel = overlay.locator(".preflight-panel");
  const actions = panel.locator(".preflight-actions");
  const cta = bridge.primaryButton();

  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(overlay).toHaveCSS("position", "fixed");
  await expect
    .poll(async () =>
      Math.round(
        await panel.evaluate((element) => element.getBoundingClientRect().bottom),
      ),
    )
    .toBe(844);

  const geometry = await page.evaluate(() => {
    const overlayElement = document.querySelector<HTMLElement>(
      ".preflight-overlay",
    )!;
    const panelElement = document.querySelector<HTMLElement>(
      ".preflight-panel",
    )!;
    const overlayRect = overlayElement.getBoundingClientRect();
    const panelRect = panelElement.getBoundingClientRect();
    return {
      overlay: {
        top: overlayRect.top,
        left: overlayRect.left,
        right: overlayRect.right,
        bottom: overlayRect.bottom,
      },
      panel: {
        top: panelRect.top,
        bottom: panelRect.bottom,
        height: panelRect.height,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  expect(geometry.overlay).toEqual({
    top: 0,
    left: 0,
    right: geometry.viewport.width,
    bottom: geometry.viewport.height,
  });
  expect(geometry.panel.bottom).toBeCloseTo(geometry.viewport.height, 0);
  expect(geometry.panel.height).toBeLessThanOrEqual(geometry.viewport.height);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport.width);

  const controls = panel.locator("button");
  for (let index = 0; index < (await controls.count()); index += 1) {
    const box = await controls.nth(index).boundingBox();
    expect(box, `sheet action ${index} is visible`).not.toBeNull();
    expect(box!.width, `sheet action ${index} width`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `sheet action ${index} height`).toBeGreaterThanOrEqual(44);
  }

  await expect(panel.locator(".preflight-confirm")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(panel.locator(".preflight-close")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(panel.locator(".preflight-confirm")).toBeFocused();

  await panel.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(actions).toBeInViewport();
  const footerBottom = await actions.evaluate(
    (element) => element.getBoundingClientRect().bottom,
  );
  expect(footerBottom).toBeLessThanOrEqual(844);

  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await expect(cta).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});
}

test("desktop review remains centered", async ({ bridge, page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openAgglayerReview(bridge);

  const geometry = await bridge.preflight().evaluate((overlay) => {
    const panel = overlay.querySelector<HTMLElement>(".preflight-panel")!;
    const overlayRect = overlay.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      overlayCenter: overlayRect.top + overlayRect.height / 2,
      panelCenter: panelRect.top + panelRect.height / 2,
      panelBottom: panelRect.bottom,
      overlayBottom: overlayRect.bottom,
    };
  });

  expect(Math.abs(geometry.overlayCenter - geometry.panelCenter)).toBeLessThan(2);
  expect(geometry.panelBottom).toBeLessThan(geometry.overlayBottom);
});
