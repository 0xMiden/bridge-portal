import { test, expect } from "../../fixtures/bridge";

// The SUT boots, WASM hydrates, both injected wallets connect, and the core UI
// (route switch + quote) works — no real network.
test("bridge boots, wallets connect, routes switch", async ({ bridge, steps, page }) => {
  await steps.step("wallets ready", async () => {
    await bridge.waitForReady();
    const hook = await page.evaluate(() => ({
      evm: window.__E2E__?.evmAddress,
      miden: window.__E2E__?.midenAddress,
      ready: window.__E2E__?.ready,
    }));
    expect(hook.ready).toBe(true);
    expect(hook.evm).toBeTruthy();
    expect(hook.miden).toBeTruthy();
  });

  await steps.step("bridge card renders", async () => {
    await expect(page.locator(".swap-card")).toBeVisible();
    await expect(page.locator(".swap-card h1")).toHaveText("Bridge");
  });

  await steps.step("route switch AggLayer <-> Epoch", async () => {
    await bridge.setRoute("Epoch");
    await expect(page.locator(".route-trigger")).toContainText("Epoch");
    await bridge.setRoute("AggLayer");
    await expect(page.locator(".route-trigger")).toContainText("AggLayer");
  });

  await steps.step("quote summary shows a network fee", async () => {
    await bridge.fillAmount("0.01");
    await expect(page.locator(".quote-summary")).toContainText("Network fee");
  });
});
