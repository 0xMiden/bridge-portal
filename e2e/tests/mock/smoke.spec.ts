import { EVM_ADDRESS, MIDEN_ADDRESS } from "../../fixtures/wallets";
import { test, expect } from "../../fixtures/bridge";

// The SUT boots, WASM hydrates, both injected wallets connect, and the core UI
// (route switch + quote) works — no real network.
test("bridge boots, wallets connect, only compatible providers are offered", async ({ bridge, page }) => {
  await test.step("wallets ready", async () => {
    await bridge.waitForReady();
    await expect(page.locator('[data-wallet="evm"] .wallet-pill')).toHaveAttribute("data-connected", "true");
    await expect(page.getByRole("button", { name: "Bread wallet menu", exact: true })).toBeVisible();
  });

  await test.step("bridge card renders", async () => {
    await expect(page.locator(".swap-card")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Bridge", exact: true })).toBeVisible();
  });

  await test.step("Circle is the default and incompatible providers are hidden", async () => {
    await bridge.expectRoute("xreserve");
    await bridge.fillAmount("0.01");
    await expect(bridge.providerOptions().locator(".provider-option")).toHaveCount(1);
    await expect(bridge.selectedProvider()).toHaveText("Circle");
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
  await bridge.expectRoute("agglayer");
  await expect(page.getByRole("textbox", { name: /Miden account|address/ })).toHaveCount(0);
  await bridge.fillAmount("0.01");
  await bridge.openPreflight();
  const walletMiden = MIDEN_ADDRESS;
  expect(walletMiden).not.toBe(midenAccount);
  await expect(destination).toHaveAttribute("title", walletMiden);
  await bridge.cancelPreflight();

  await page.goto(`/?provider=xreserve&mode=send&evmAddress=${evmAddress}`);
  await bridge.waitForReady();
  await bridge.expectRoute("xreserve");
  await expect(page.locator(".mode-switch button[aria-pressed='true']")).toHaveText("Withdraw");
  const withdrawalRequest = page.waitForRequest("**/api/xreserve/withdrawal-quote", { timeout: 20_000 });
  await bridge.fillAmount("2");
  const walletEvm = EVM_ADDRESS;
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
  await bridge.expectRoute("xreserve");
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

test("routes appear below the form only after a valid amount and successful quote", async ({ bridge, page }, info) => {
  const details = page.locator(".transfer-route-details");
  const providers = bridge.providerOptions();
  for (const amount of ["", "0", "-1", "abc", "1e3", "1.0000001"]) {
    await bridge.fillAmount(amount);
    await expect(details).toBeHidden();
    await expect(providers).toBeHidden();
  }
  await bridge.fillAmount("1");
  await expect(details).toBeVisible();
  await expect(providers.locator(".provider-option")).toHaveCount(1);
  await expect(bridge.selectedProvider()).toHaveText("Circle");
  await bridge.fillAmount("");
  await expect(details).toBeHidden();
  await expect(providers).toBeHidden();

  await bridge.setRoute("AggLayer");
  await bridge.fillAmount("0.01");
  await expect(providers.locator(".provider-option")).toHaveCount(1);
  await expect(bridge.selectedProvider()).toHaveText("Agglayer");
  await expect(page.locator(".readonly-amount")).toContainText("0.01");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const form = await page.locator(".swap-card").boundingBox();
    const options = await page.locator(".provider-card").boundingBox();
    expect(options!.y).toBeGreaterThanOrEqual(form!.y + form!.height);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`routes-${width}.png`), fullPage: true, animations: "disabled" });
  }
});
