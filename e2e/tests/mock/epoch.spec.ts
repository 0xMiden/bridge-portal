import { test, expect } from "../../fixtures/bridge";

for (const mode of ["receive", "send"] as const) {
  test(`Epoch ${mode}: restore a retired selection, quote the current faucet and submit`, async ({ bridge, page }) => {
    await page.route("**/suggested-nonce/**", (route) => route.fulfill({ json: { nonce: "1" } }));
    await page.route("**/checkIfDepositNeeded", (route) => route.fulfill({
      json: { tokenOut: mode === "receive" ? "991878" : "990000000000000000" },
    }));
    await page.evaluate((mode) => {
      localStorage.setItem("miden.bridge.ui.route", "epoch");
      localStorage.setItem("miden.bridge.ui.mode", mode);
      localStorage.setItem("miden.bridge.ui.route.id", `epoch-usdc-to-${mode === "receive" ? "miden" : "sepolia"}`);
    }, mode);
    await page.reload();
    await bridge.waitForReady();
    await expect(bridge.selectedProvider()).toContainText("Epoch");
    await page.goto(`/?provider=epoch&mode=${mode}`);
    await bridge.waitForReady();
    await expect(page.locator(".mode-switch button[aria-pressed='true']"))
      .toHaveText(mode === "send" ? "Withdraw" : "Deposit");

    const request = page.waitForRequest("**/checkIfDepositNeeded");
    await bridge.fillAmount("1");
    const payload = (await request).postDataJSON();
    expect(payload.chainId).toBe(mode === "send" ? "999999999" : "11155111");
    expect(payload.compact.mandate).toMatchObject({
      midenFaucetId: "0x5b043dcb48d5721106f7a1ceb2b804",
      tokenInAmount: mode === "send" ? "1000000" : "1000000000000000000",
    });
    await bridge.openPreflight();
    await expect(bridge.preflight()).toContainText(mode === "receive" ? "0.991878" : "0.99");
    await bridge.confirmPreflight();
    await bridge.waitForActivityPage();
    expect((await bridge.readActivities())[0]).toMatchObject({
      provider: "epoch", mode,
      routeId: `epoch-test-usdc-to-${mode === "receive" ? "miden" : "sepolia"}`,
    });
  });
}

test("Epoch token choices distinguish mocks and keep USDCx withdrawal-only", async ({ bridge, page }) => {
  await page.goto("/?provider=epoch&mode=receive");
  await bridge.waitForReady();
  await page.locator(".token-select-trigger").first().click();
  const tokens = page.getByRole("listbox", { name: "Token", exact: true });
  for (const symbol of ["USDC", "DAI", "USDT", "WBTC"]) {
    await expect(tokens.getByRole("option", { name: `${symbol} Epoch test ${symbol}`, exact: true })).toBeVisible();
  }
  await expect(tokens.getByRole("option", { name: "USDC Circle USDC", exact: true })).toBeVisible();
  await expect(tokens.getByRole("option", { name: /WETH/ })).toHaveCount(0);
  await tokens.getByRole("option", { name: "USDC Circle USDC", exact: true }).click();
  await bridge.setMode("Send");
  // Keep the actual USDCx faucet as source; choose Epoch's mock as destination.
  await page.locator(".token-select-trigger").last().click();
  await tokens.getByRole("option", { name: "USDC Epoch test USDC", exact: true }).click();
  await expect(bridge.selectedProvider()).toContainText("Epoch");
  await expect(page.locator(".token-select-trigger").first()).toContainText("USDCx");
  await expect(page.locator(".mode-switch").getByRole("button", { name: "Deposit", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Get testnet funds", exact: true }).click();
  await expect(page.getByRole("link", { name: "Epoch test token faucets", exact: true }))
    .toHaveAttribute("href", "https://userdashboard.epochprotocol.xyz/faucets");
});

test("Epoch cannot reach review when the allocator has no estimate", async ({ bridge, page }) => {
  await page.route("**/suggested-nonce/**", (route) => route.fulfill({ json: { nonce: "1" } }));
  await page.route("**/checkIfDepositNeeded", (route) => route.fulfill({
    status: 400, json: { error: "A quote isn't available for this intent" },
  }));
  await page.goto("/?provider=epoch&mode=receive");
  await bridge.waitForReady();
  await bridge.fillAmount("1");
  await expect(page.locator(".form-error")).toContainText("A quote isn't available for this intent");
  await bridge.primaryButton().click();
  await expect(bridge.preflight()).toBeHidden();
  expect(await bridge.readActivities()).toEqual([]);
});
