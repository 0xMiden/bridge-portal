import { test, expect } from "../../fixtures/bridge";
import { stubNetwork } from "../../fixtures/mock-network";
import { routesForEnvironment } from "../../../src/bridge/core/routes";

test("network selection isolates forms, preferences and tabs", async ({ bridge, page, context }, info) => {
  await bridge.setRoute("AggLayer");
  await bridge.fillAmount("0.01");
  await page.getByRole("combobox", { name: "Bridge network" }).selectOption("mainnet");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveValue("mainnet");
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
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveValue("mainnet");
  await expect(bridge.selectedProvider()).toContainText("Agglayer");
  await expect(page).toHaveURL(/\/$/);

  const second = await context.newPage();
  await stubNetwork(second);
  await second.goto("/");
  await expect(second.getByRole("combobox", { name: "Bridge network" })).toHaveValue("testnet");
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveValue("mainnet");
  await second.close();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: info.outputPath("mainnet-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("mainnet-mobile.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("combobox", { name: "Bridge network" }).selectOption("testnet");
  await expect(page).toHaveURL(/\/$/);
  await expect(bridge.selectedProvider()).toContainText("Agglayer");
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("");
  await page.screenshot({ path: info.outputPath("testnet-mobile.png"), fullPage: true, animations: "disabled" });
});

test("receipt links restore their saved network and preserve legacy testnet history", async ({ page, bridge }, info) => {
  await page.evaluate(() => localStorage.setItem("miden.bridge.ui.activities", JSON.stringify([{
    id: "legacy", mode: "receive", provider: "agglayer", status: "complete", amount: "0.01", asset: "ETH",
    summary: "Receive 0.01 ETH on Miden", eta: "10-20 min", txHash: "0xpending", updatedAt: 1_700_000_000_000,
  }])));
  await page.getByRole("combobox", { name: "Bridge network" }).selectOption("mainnet");
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveValue("mainnet");
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No transfers yet" })).toBeVisible();
  expect(await bridge.readActivities()).toHaveLength(1);

  await page.goto("/activity/legacy");
  await expect(page).toHaveURL(/\/activity\/legacy$/);
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveValue("testnet");
  await expect(page.getByRole("article", { name: "Transfer receipt" })).toContainText("Sepolia");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("receipt-mobile.png"), fullPage: true, animations: "disabled" });

  // Switching from a receipt opens a fresh form instead of changing its network.
  await page.getByRole("combobox", { name: "Bridge network" }).selectOption("mainnet");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveValue("mainnet");
  await page.getByRole("combobox", { name: "Bridge network" }).selectOption("testnet");
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveValue("testnet");

  const mainnetRoute = routesForEnvironment("mainnet").find(route =>
    route.provider === "agglayer" && route.mode === "receive" && route.source.network === "ethereum");
  expect(mainnetRoute).toBeDefined();
  await page.evaluate(routeSnapshot => {
    const activities = JSON.parse(localStorage.getItem("miden.bridge.ui.activities")!);
    activities.push({ ...activities[0], id: "mainnet-receipt", environment: "mainnet", routeSnapshot });
    localStorage.setItem("miden.bridge.ui.activities", JSON.stringify(activities));
  }, mainnetRoute);
  await page.goto("/activity/mainnet-receipt");
  await expect(page.getByRole("combobox", { name: "Bridge network" })).toHaveValue("mainnet");
  await expect(page.getByRole("article", { name: "Transfer receipt" })).toContainText("Ethereum");
  await expect(page.getByRole("article", { name: "Transfer receipt" })).not.toContainText("Sepolia");
});
