import { test, expect } from "../../fixtures/bridge";

test("switching chains shows loading until the balance resolves, and only failures show unavailable", async ({ bridge, page }, testInfo) => {
  await bridge.setMode("Receive");
  const balance = page.locator(".swap-box").first().locator(".balance-line");
  await expect(balance).toHaveText("Available 1 USDC");

  const requested = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let fail = false;
  await page.route("**/api/evm/sepolia/balance**", async (route) => {
    requested.resolve();
    await release.promise;
    await route.fulfill(fail
      ? { status: 502, json: { error: "RPC unavailable" } }
      : { json: { balanceRaw: "750000" } });
  });

  await page.getByRole("combobox", { name: "Origin chain", exact: true }).selectOption("sepolia");
  await requested.promise;
  try {
    await expect(balance).not.toContainText("Balance unavailable", { timeout: 1_000 });
    await expect(balance.getByRole("status")).toHaveText("Loading USDC balance…");
    await expect(balance).not.toContainText("1 USDC");
    await page.screenshot({ path: testInfo.outputPath("balance-loading-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath("balance-loading-mobile.png") });
  } finally {
    release.resolve();
  }
  await expect(balance).toHaveText("Available 0.75 USDC");
  await page.getByRole("combobox", { name: "Origin chain", exact: true }).selectOption("arc-testnet");
  await expect(balance).toHaveText("Available 1 USDC");
  await expect(balance.getByRole("status")).toHaveCount(0);

  // Reload drops the in-memory cache so this is a real failed read for Sepolia USDC.
  fail = true;
  await page.reload();
  await bridge.waitForReady();
  await page.getByRole("combobox", { name: "Origin chain", exact: true }).selectOption("sepolia");
  await expect(balance).toHaveText("Balance unavailable");
  await expect(balance.getByRole("status")).toHaveCount(0);
});
