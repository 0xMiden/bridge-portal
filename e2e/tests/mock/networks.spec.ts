import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures/bridge";
import { stubNetwork } from "../../fixtures/mock-network";
import { routesForEnvironment } from "../../../src/bridge/core/routes";
import { startOnTestnet } from "../../fixtures/testnet";

async function selectNetwork(page: Page, network: "Mainnet" | "Testnet") {
  await page.getByRole("combobox", { name: "Bridge network" }).click();
  await page.getByRole("option", { name: network, exact: true }).click();
}

test("routes load on a fresh visit without remote configuration or registry discovery", async ({ page }) => {
  await startOnTestnet(page);
  const configRequests: string[] = [];
  await page.route(/\/api\/wallet-config|raw\.githubusercontent\.com\/0xMiden\/wallet-config|rpc\.(testnet|cedar)\.miden\.io/, route => {
    configRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toBeVisible({ timeout: 10_000 });
  await selectNetwork(page, "Mainnet");
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toBeVisible();
  expect(configRequests).toEqual([]);
});

test("mainnet tokens select matching Miden assets and explain unsupported precision", async ({ bridge, page }, info) => {
  await page.route("**/api/evm/ethereum/gas**", route =>
    route.fulfill({ json: { gasPriceWei: "1200000000", gwei: "1.2" } }));
  await selectNetwork(page, "Mainnet");
  await bridge.setChain("Ethereum");
  for (const [symbol, name] of [["USDT", "Tether USD"], ["WBTC", "Wrapped BTC"], ["PYUSD", "PayPal USD"], ["WSOL", "Wrapped SOL"]]) {
    await bridge.fillAmount("0.1");
    await page.locator(".swap-box[data-side='source']").getByRole("button", { name: /change token/ }).click();
    await page.getByRole("option", { name: `${symbol} ${name}`, exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("");
    await expect(page.locator(".swap-box[data-side='destination']").getByRole("button", { name: `${symbol} — change token`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reverse transfer direction" })).toBeDisabled();
    await bridge.fillAmount("0.1");
    await expect(bridge.selectedProvider()).toContainText("Agglayer");
  }
  await page.reload();
  await expect(page.locator(".swap-box[data-side='source']").getByRole("button", { name: "WSOL — change token", exact: true })).toBeVisible();
  await bridge.fillAmount("0.000000001");
  await expect(page.locator(".swap-card").getByRole("alert")).toContainText("Miden supports at most 8 decimal places for WSOL");
  await expect(bridge.primaryButton()).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveAttribute("aria-invalid", "true");
  await bridge.fillAmount("0.12345678");
  await expect(page.locator(".swap-card").getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Expected received", { exact: true })).toContainText("0.12345678");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".swap-box[data-side='source']").getByRole("button", { name: /change token/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("mainnet-tokens-mobile.png"), fullPage: true, animations: "disabled" });
});

test("network selection isolates forms, preferences and tabs", async ({ bridge, page, context }, info) => {
  await bridge.setRoute("AggLayer");
  await bridge.fillAmount("0.01");
  await selectNetwork(page, "Mainnet");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveText("Mainnet");
  await expect(page.getByRole("button", { name: "Get testnet funds", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: /Origin chain/ }).click();
  await expect(page.getByRole("listbox", { name: /Origin chain/ })).toContainText("Ethereum");
  await expect(page.getByRole("listbox", { name: /Origin chain/ }).getByRole("option", { name: /Sepolia|Testnet/ })).toHaveCount(0);
  await page.getByRole("option", { name: "Ethereum", exact: true }).click();
  await page.locator(".token-select-trigger").first().click();
  await expect(page.getByRole("option", { name: /Epoch/ })).toHaveCount(0);
  await page.getByRole("option", { name: "ETH Ether", exact: true }).click();
  await bridge.fillAmount("0.02");
  await expect(bridge.selectedProvider()).toContainText("Agglayer");
  await expect(page.locator(".topbar-error")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveText("Mainnet");
  await expect(bridge.selectedProvider()).toContainText("Agglayer");
  await expect(page).toHaveURL(/\/$/);

  const second = await context.newPage();
  await stubNetwork(second);
  await second.goto("/");
  await expect(second.getByRole("combobox", { name: "Bridge network" })).toHaveText("Mainnet");
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveText("Mainnet");
  await second.close();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: info.outputPath("mainnet-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("mainnet-mobile.png"), fullPage: true, animations: "disabled" });
  await selectNetwork(page, "Testnet");
  await expect(page).toHaveURL(/\/$/);
  await expect(bridge.selectedProvider()).toContainText("Agglayer");
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("");
  await page.screenshot({ path: info.outputPath("testnet-mobile.png"), fullPage: true, animations: "disabled" });
});

test("receipt links restore their saved network and preserve testnet receipts", async ({ page, bridge }, info) => {
  await page.evaluate(routeSnapshot => localStorage.setItem("miden.bridge.ui.activities.v2", JSON.stringify([{
    id: "legacy", routeSnapshot, environment: "testnet", mode: "receive", provider: "agglayer", status: "complete", amount: "0.01", asset: "ETH",
    summary: "Receive 0.01 ETH on Miden", eta: "10-20 min", txHash: "0xpending", updatedAt: 1_700_000_000_000,
  }])), routesForEnvironment("testnet").find(route => route.id === "agglayer-eth-to-miden")!);
  await selectNetwork(page, "Mainnet");
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveText("Mainnet");
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No transfers yet" })).toBeVisible();
  expect(await bridge.readActivities()).toHaveLength(1);

  await page.goto("/activity/legacy");
  await expect(page).toHaveURL(/\/activity\/legacy$/);
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveText("Testnet");
  await expect(page.getByRole("article", { name: "Transfer receipt" })).toContainText("Sepolia");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("receipt-mobile.png"), fullPage: true, animations: "disabled" });

  // Switching from a receipt opens a fresh form instead of changing its network.
  await selectNetwork(page, "Mainnet");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveText("Mainnet");
  await selectNetwork(page, "Testnet");
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveText("Testnet");

  const mainnetRoute = routesForEnvironment("mainnet").find(route =>
    route.provider === "agglayer" && route.mode === "receive" && route.source.network === "ethereum");
  expect(mainnetRoute).toBeDefined();
  await page.evaluate(routeSnapshot => {
    const activities = JSON.parse(localStorage.getItem("miden.bridge.ui.activities.v2")!);
    activities.push({ ...activities[0], id: "mainnet-receipt", environment: "mainnet", routeSnapshot });
    localStorage.setItem("miden.bridge.ui.activities.v2", JSON.stringify(activities));
  }, mainnetRoute);
  await page.goto("/activity/mainnet-receipt");
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveText("Mainnet");
  await expect(page.getByRole("article", { name: "Transfer receipt" })).toContainText("Ethereum");
  await expect(page.getByRole("article", { name: "Transfer receipt" })).not.toContainText("Sepolia");
});
