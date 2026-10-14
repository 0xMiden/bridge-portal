import { test, expect } from "../../fixtures/bridge";

// The SUT boots, WASM hydrates, both injected wallets connect, and the core UI
// (route switch + quote) works — no real network.
test("bridge boots, wallets connect, paused routes are disabled", async ({ bridge, page }) => {
  await test.step("wallets ready", async () => {
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

  await test.step("bridge card renders", async () => {
    await expect(page.locator(".swap-card")).toBeVisible();
    await expect(page.locator(".swap-card h1")).toHaveText("Bridge");
  });

  await test.step("USDCx is the default and paused routes cannot be selected", async () => {
    await expect(bridge.routeTrigger()).toContainText("USDCx");
    await bridge.routeTrigger().click();
    const option = bridge.routeListbox().getByRole("option", { name: /^Epoch/ });
    await expect(option).toBeDisabled();
    await expect(option).toContainText("Paused");
    await page.keyboard.press("Escape");
  });

  await test.step("quote summary shows a network fee", async () => {
    await bridge.fillAmount("0.01");
    await expect(page.locator(".quote-summary")).toContainText("Network fee");
  });
});

test("launch links use canonical provider, mode and recipient parameters", async ({ bridge, page }) => {
  const midenAccount = "0x387149ae66116cf114eebd60bb7381";
  const evmAddress = `0x${"12".repeat(20)}`;
  const destination = page.locator(".destination-input input");

  await page.goto(`/?provider=agglayer&mode=receive&midenAccount=${midenAccount}`);
  await bridge.waitForReady();
  await expect(bridge.routeTrigger()).toContainText("Agglayer");
  await expect(destination).toHaveValue(midenAccount);

  await page.goto(`/?provider=xreserve&mode=send&evmAddress=${evmAddress}`);
  await bridge.waitForReady();
  await expect(bridge.routeTrigger()).toContainText("USDCx");
  await expect(page.locator(".mode-switch button[aria-pressed='true']")).toHaveText("Send");
  await expect(destination).toHaveValue(evmAddress);

  await page.evaluate(() => {
    localStorage.removeItem("miden.bridge.ui.route");
    localStorage.removeItem("miden.bridge.ui.route.id");
    localStorage.removeItem("miden.bridge.ui.mode");
  });
  await page.goto(`/?route=agglayer&intent=withdraw&mode=deposit&miden_account=${midenAccount}&account=${midenAccount}`);
  await bridge.waitForReady();
  await expect(bridge.routeTrigger()).toContainText("USDCx");
  await expect(page.locator(".mode-switch button[aria-pressed='true']")).toHaveText("Receive");
  const walletMiden = await page.evaluate(() => window.__E2E__!.midenAddress!);
  await expect(destination).toHaveValue(walletMiden);

  await page.goto(`/?mode=send&evm_address=${evmAddress}&recipient=${evmAddress}`);
  await bridge.waitForReady();
  const walletEvm = await page.evaluate(() => window.__E2E__!.evmAddress!);
  await expect(destination).toHaveValue(walletEvm);
});
