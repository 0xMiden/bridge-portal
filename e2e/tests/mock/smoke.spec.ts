import { test, expect } from "../../fixtures/bridge";

// The SUT boots, WASM hydrates, both injected wallets connect, and the core UI
// (route switch + quote) works — no real network.
test("bridge boots, wallets connect, only compatible providers are offered", async ({ bridge, page }) => {
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
    await expect(page.getByRole("tab", { name: "Bridge", exact: true })).toBeVisible();
  });

  await test.step("USDCx is the default and incompatible providers are hidden", async () => {
    await expect(bridge.selectedProvider()).toContainText("USDCx");
    await bridge.fillAmount("0.01");
    await bridge.routeTrigger().click();
    await expect(bridge.providerOptions().getByRole("button")).toHaveCount(1);
    await expect(bridge.providerOptions().getByRole("button")).toContainText("USDCx");
    await page.keyboard.press("Escape");
  });

  await test.step("quote summary shows a network fee", async () => {
    await bridge.fillAmount("0.01");
    await expect(page.locator(".quote-summary")).toContainText("Network fee");
  });
});

test("launch links select the route but connected wallets determine both recipients", async ({ bridge, page }) => {
  const midenAccount = "0x387149ae66116cf114eebd60bb7381";
  const evmAddress = `0x${"12".repeat(20)}`;
  const destination = page.locator("#preflight-destination-value");
  await page.route("**/api/xreserve/withdrawal-quote", (route) => route.fulfill({
    json: { ...route.request().postDataJSON(), received: "1983600", fee: "16400", expiresAt: Date.now() + 60_000 },
  }));

  await page.goto(`/?provider=agglayer&mode=receive&midenAccount=${midenAccount}`);
  await bridge.waitForReady();
  await expect(bridge.selectedProvider()).toContainText("Agglayer");
  await expect(page.getByRole("textbox", { name: /Miden account|address/ })).toHaveCount(0);
  await bridge.fillAmount("0.01");
  await bridge.openPreflight();
  const walletMiden = await page.evaluate(() => window.__E2E__!.midenAddress!);
  expect(walletMiden).not.toBe(midenAccount);
  await expect(destination).toHaveAttribute("title", walletMiden);
  await bridge.cancelPreflight();

  await page.goto(`/?provider=xreserve&mode=send&evmAddress=${evmAddress}`);
  await bridge.waitForReady();
  await expect(bridge.selectedProvider()).toContainText("USDCx");
  await expect(page.locator(".mode-switch button[aria-pressed='true']")).toHaveText("Withdraw");
  const withdrawalRequest = page.waitForRequest("**/api/xreserve/withdrawal-quote", { timeout: 20_000 });
  await bridge.fillAmount("2");
  const walletEvm = await page.evaluate(() => window.__E2E__!.evmAddress!);
  expect(walletEvm).not.toBe(evmAddress);
  expect((await withdrawalRequest).postDataJSON()).toMatchObject({ recipient: walletEvm, sender: walletMiden });
  await bridge.openPreflight();
  await expect(destination).toHaveAttribute("title", walletEvm);
  await bridge.cancelPreflight();

  await page.evaluate(() => {
    localStorage.removeItem("miden.bridge.ui.route");
    localStorage.removeItem("miden.bridge.ui.route.id");
    localStorage.removeItem("miden.bridge.ui.mode");
    localStorage.removeItem("miden.bridge.ui.route.testnet");
    localStorage.removeItem("miden.bridge.ui.route.testnet.id");
    localStorage.removeItem("miden.bridge.ui.mode.testnet");
  });
  await page.goto(`/?route=agglayer&intent=withdraw&mode=deposit&miden_account=${midenAccount}&account=${midenAccount}`);
  await bridge.waitForReady();
  await expect(bridge.selectedProvider()).toContainText("USDCx");
  await expect(page.locator(".mode-switch button[aria-pressed='true']")).toHaveText("Deposit");
});

test("Activity navigation preserves the form and the reverse control swaps the wallet panels", async ({ bridge, page }) => {
  await bridge.fillAmount("2");
  await page.getByRole("tab", { name: "Bridge", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Activity", exact: true })).toBeFocused();
  await expect(page.getByRole("heading", { name: "No transfers yet" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toBeHidden();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "Reverse transfer direction" }).click();
  await expect(page.getByRole("button", { name: "Withdraw", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.swap-box[data-side="source"] .panel-wallet')).toContainText(/mtst1/);
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("");
  await expect(page.locator(".transfer-route-details")).toBeHidden();
  await expect(page.locator('.swap-box[data-side="destination"] .panel-wallet')).toHaveAttribute("data-wallet", "evm");
  await page.getByRole("button", { name: "Reverse transfer direction" }).click();
  await expect(page.getByRole("button", { name: "Deposit", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.swap-box[data-side="destination"] .panel-wallet')).toHaveAttribute("data-wallet", "miden");
});

test("route stays hidden until a valid amount and expands only compatible providers", async ({ bridge, page }, info) => {
  const details = page.locator(".transfer-route-details");
  for (const amount of ["", "0", "-1", "abc", "1e3", "1.0000001"]) {
    await bridge.fillAmount(amount);
    await expect(details).toBeHidden();
    await expect(bridge.routeTrigger()).toBeHidden();
  }
  await bridge.fillAmount("1");
  await expect(details).toBeVisible();
  await expect(bridge.providerOptions()).toBeHidden();
  await bridge.routeTrigger().click();
  await expect(bridge.providerOptions().getByRole("button")).toHaveCount(1);
  await expect(bridge.providerOptions().getByRole("button")).toContainText("USDCx");
  await bridge.fillAmount("");
  await expect(details).toBeHidden();
  await bridge.fillAmount("2");
  await expect(bridge.providerOptions()).toBeHidden();

  await bridge.setRoute("AggLayer");
  await expect(details).toBeHidden();
  await bridge.fillAmount("0.01");
  await bridge.routeTrigger().click();
  const selected = bridge.providerOptions().getByRole("button", { name: /Agglayer/ });
  await expect(bridge.providerOptions().getByRole("button")).toHaveCount(1);
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await selected.click();
  await expect(bridge.providerOptions()).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("0.01");
  await expect(page.locator(".readonly-amount")).toContainText("0.01");
  await page.screenshot({ path: info.outputPath("route-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await bridge.routeTrigger().click();
  await expect(bridge.providerOptions()).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("route-mobile.png"), fullPage: true, animations: "disabled" });
});
