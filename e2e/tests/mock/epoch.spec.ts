import { test, expect } from "../../fixtures/bridge";
import { epochWalletPaidHealth } from "../../../test/epoch-service";

test.beforeEach(async ({ bridge, page }) => {
  // Initialize the bridge's default network stubs before overriding Epoch health.
  await bridge.waitForReady();
  await page.route(/https:\/\/[^/]+\.epochprotocol\.xyz\/health$/, route => route.fulfill({ json: epochWalletPaidHealth() }));
});

for (const mode of ["receive", "send"] as const) {
  test(`Epoch ${mode}: restore a retired selection, quote the current faucet and review`, async ({ bridge, page }) => {
    await page.route("**/suggested-nonce/**", (route) => route.fulfill({ json: { nonce: "1" } }));
    await page.route("**/checkIfDepositNeeded", (route) => route.fulfill({
      json: { tokenOut: mode === "receive" ? "991878" : "990000000000000000" },
    }));
    await page.evaluate((mode) => {
      localStorage.setItem("miden.bridge.ui.route.testnet", "epoch");
      localStorage.setItem("miden.bridge.ui.mode.testnet", mode);
      localStorage.setItem("miden.bridge.ui.route.testnet.id", `epoch-usdc-to-${mode === "receive" ? "miden" : "sepolia"}`);
    }, mode);
    await page.reload();
    await bridge.waitForReady();
    await bridge.expectRoute("epoch");
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
    await bridge.cancelPreflight();
    expect(await bridge.readActivities()).toEqual([]);
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
  await bridge.expectRoute("epoch");
  await expect(page.locator(".token-select-trigger").first()).toContainText("USDCx");
  await expect(page.locator(".mode-switch").getByRole("button", { name: "Deposit", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Get testnet funds", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Epoch test token faucets", exact: true }))
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
  await expect(page.locator(".provider-card")).toContainText("No quotes available");
  await expect(bridge.primaryButton()).toBeDisabled();
  await expect(bridge.preflight()).toBeHidden();
  expect(await bridge.readActivities()).toEqual([]);
});


const mainnetPairs = [
  ...([["ethereum", 1], ["base", 8453], ["arbitrum", 42161], ["polygon", 137]] as const).map(([network, chainId]) => ({
    network, chainId, token: "USDC", suffix: "", amount: "1", faucet: "0xe69e6ca6e39df1b10c1e5399399feb",
    receiveUnits: "1000000", sendUnits: "1000000", receiveOut: "991878", sendOut: "991878", received: "0.991878", native: false,
  })),
  ...([["ethereum", 1], ["base", 8453], ["arbitrum", 42161], ["robinhood", 4663]] as const).map(([network, chainId]) => ({
    network, chainId, token: "ETH", suffix: ":eth", amount: "0.01", faucet: "0x419f8f4bff72959132aa7cea15a4c1",
    receiveUnits: "10000000000000000", sendUnits: "1000000", receiveOut: "999500", sendOut: "9995000000000000", received: "0.009995", native: true,
  })),
  { network: "polygon", chainId: 137, token: "POL", suffix: ":pol", amount: "0.1", faucet: "0xa5b56b51edbda2514c711385dc6f31",
    receiveUnits: "100000000000000000", sendUnits: "10000000", receiveOut: "9995000", sendOut: "99950000000000000", received: "0.09995", native: true },
  { network: "robinhood", chainId: 4663, token: "USDG", suffix: ":usdg", amount: "1", faucet: "0xfc340a73c8fb25d1412f3fa1fd6d3a",
    receiveUnits: "1000000", sendUnits: "1000000", receiveOut: "999500", sendOut: "999500", received: "0.9995", native: false },
];

for (const pair of mainnetPairs) {
  const { network, chainId } = pair;
  const hasAgglayerQuote = network === "ethereum" && pair.token === "ETH";
  for (const mode of ["receive", "send"] as const) {
    test(`Cedar Epoch ${network} ${pair.token} ${mode}: quotes the selected chain and invalidates a changed amount`, async ({ bridge, page }) => {
      const endpoint = "https://mainnet-api.epochprotocol.xyz";
      await page.route(`${endpoint}/suggested-nonce/**`, route => route.fulfill({ json: { nonce: "1" } }));
      await page.route(`${endpoint}/checkIfDepositNeeded`, route => {
        const amount = route.request().postDataJSON().compact.mandate.tokenInAmount;
        return route.fulfill({ json: { tokenOut: amount === (mode === "send" ? pair.sendUnits : pair.receiveUnits)
          ? (mode === "send" ? pair.sendOut : pair.receiveOut) : "0" } });
      });
      await page.route("**/api/evm/*/gas**", route => route.fulfill({ json: { gasPriceWei: "1200000000", gwei: "1.2" } }));
      await page.evaluate(({ network, suffix, mode }) => {
        localStorage.setItem("miden.bridge.ui.route.mainnet", "epoch");
        localStorage.setItem("miden.bridge.ui.mode.mainnet", mode);
        localStorage.setItem("miden.bridge.ui.route.mainnet.id", `mainnet:epoch:${network}${suffix}:${mode}`);
      }, { network, suffix: pair.suffix, mode });
      await page.getByRole("combobox", { name: "Bridge network" }).click();
      await page.getByRole("option", { name: "Mainnet", exact: true }).click();
      await bridge.expectRoute("epoch");
      await page.locator('[data-wallet="miden"] .wallet-pill').click();
      await page.getByRole("menuitem", { name: "Connect wallet", exact: true }).click();
      await expect(page.locator('[data-wallet="miden"] .wallet-pill')).toHaveAttribute("data-connected", "true");
      const request = page.waitForRequest(`${endpoint}/checkIfDepositNeeded`, { timeout: 20_000 });
      await bridge.fillAmount(pair.amount);
      const payload = (await request).postDataJSON();
      expect(payload.chainId).toBe(String(mode === "send" ? 999999999 : chainId));
      expect(payload.compact.mandate).toMatchObject({
        destinationChainId: String(mode === "send" ? chainId : 999999999),
        midenFaucetId: pair.faucet, tokenInAmount: mode === "send" ? pair.sendUnits : pair.receiveUnits,
      });
      if (pair.native) expect(payload.compact.mandate).toMatchObject({
        tokenIn: "0x0000000000000000000000000000000000000000",
        tokenOut: "0x0000000000000000000000000000000000000000",
      });
      if (hasAgglayerQuote) await page.locator("label.provider-option")
        .filter({ has: page.getByRole("radio", { name: "Epoch", exact: true }) }).click();
      await expect(bridge.selectedProvider()).toHaveText("Epoch");
      await bridge.openPreflight();
      await expect(bridge.preflight()).toContainText(pair.received);
      if (network === "polygon" && mode === "receive") await expect(bridge.preflight()).toContainText("POL");
      await bridge.cancelPreflight();
      await bridge.fillAmount("0.5");
      if (hasAgglayerQuote) {
        await bridge.expectRoute("agglayer");
        await expect(page.locator(".provider-card")).not.toContainText("Epoch");
        await expect(page.locator(".provider-card")).not.toContainText(pair.received);
      } else {
        await expect(page.locator(".provider-card")).toContainText("No quotes available");
        await expect(bridge.primaryButton()).toBeDisabled();
      }
      await expect(bridge.preflight()).toBeHidden();
      expect(await bridge.readActivities()).toEqual([]);
    });
  }
}
