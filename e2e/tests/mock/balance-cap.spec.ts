import { respondToWallet, SOURCE_TX } from "../../fixtures/wallets";
import { expect, test, type Page } from "@playwright/test";
import { stubNetwork } from "../../fixtures/mock-network";
import { startOnTestnet } from "../../fixtures/testnet";
import { BridgePage } from "../../pages/bridge-page";
import { decodeFunctionData, encodeFunctionResult, erc20Abi } from "viem";
import { arcConfig, xReserveAbi } from "../../../src/bridge/providers/xreserve/config";
import { arcRecipient } from "../../../src/bridge/providers/xreserve/deposit-terms";

async function priceAccount(page: Page, ethPrice: () => string) {
  await page.route("**/api/prices?**", (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol");
    const usdDecimal = symbol === "ETH" ? ethPrice() : "1";
    return route.fulfill({ json: { symbol, usd: Number(usdDecimal), usdDecimal, fetchedAt: Date.now() } });
  });
}

test.beforeEach(async ({ page }) => {
  await startOnTestnet(page);
  await stubNetwork(page, { usdcBalance: "10000" });
});

test("the deposit allowance includes other holdings and recovers when the amount is reduced", async ({ page }, testInfo) => {
  // The mock account holds 0.1 ETH and 1 Epoch USDC, even when depositing USDCx.
  // At these prices the total account value is exactly $1,000.
  const ethRequested = Promise.withResolvers<void>();
  const releasePrices = Promise.withResolvers<void>();
  await page.route("**/api/prices?**", async (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol");
    if (symbol === "ETH") ethRequested.resolve();
    await releasePrices.promise;
    const usdDecimal = symbol === "ETH" ? "9990" : "1";
    await route.fulfill({ json: { symbol, usd: Number(usdDecimal), usdDecimal, fetchedAt: Date.now() } });
  });
  await page.goto("/?provider=xreserve&mode=receive");
  const bridge = new BridgePage(page);
  await bridge.waitForReady();
  const formAlerts = page.getByRole("region", { name: "Miden bridge", exact: true }).getByRole("alert");
  try {
    await bridge.fillAmount("200");
    await ethRequested.promise;
    await expect(bridge.primaryButton()).toBeDisabled();
    expect(await page.getByText(/checking.*(?:balance|limit)/i).count()).toBe(0);
    expect(await page.getByRole("status").filter({ hasText: /balance|limit/i }).count()).toBe(0);
    expect(await formAlerts.count()).toBe(0);
    expect(await page.getByText(/\$1,232\.462/).count()).toBe(0);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: testInfo.outputPath(`balance-cap-silent-loading-${viewport.width}.png`), fullPage: true, animations: "disabled" });
    }
  } finally {
    releasePrices.resolve();
  }

  // Below and exactly at the cap stay silent once the account is priced.
  await expect(bridge.primaryButton()).toBeEnabled();
  await expect(formAlerts).toHaveCount(0);
  await bridge.fillAmount("232.462");
  await expect(bridge.primaryButton()).toBeEnabled();
  await expect(formAlerts).toHaveCount(0);
  await expect(page.getByText(/\$1,232\.462/)).toHaveCount(0);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: testInfo.outputPath(`balance-cap-exact-${viewport.width}.png`), fullPage: true, animations: "disabled" });
  }

  // A single USDC base unit above the allowance must show the limit warning.
  await bridge.fillAmount("232.462001");
  await expect(page.locator("#amount-error")).toContainText("$1,232.462");
  await expect(bridge.primaryButton()).toBeDisabled();
  await expect(bridge.preflight()).toBeHidden();
  expect(await bridge.readActivities()).toHaveLength(0);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("#amount-error")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`balance-cap-${viewport.width}.png`), fullPage: true, animations: "disabled" });
  }

  await bridge.fillAmount("232.462");
  await expect(page.locator("#amount-error")).toHaveCount(0);
  await expect(bridge.primaryButton()).toBeEnabled();
  await bridge.openPreflight();
  await expect(page.locator(".preflight-quantity")).toHaveText("232.462 USDC");
});

test("confirmation rechecks prices and a price outage still permits withdrawal review", async ({ page }) => {
  let ethPrice = "9990";
  await priceAccount(page, () => ethPrice);
  await page.goto("/?provider=agglayer&mode=receive");
  const bridge = new BridgePage(page);
  await bridge.waitForReady();
  await bridge.fillAmount("0.01");
  await bridge.openPreflight();

  // The reviewed $1,099.90 total becomes $2,201 before the wallet is invoked.
  ethPrice = "20000";
  await bridge.confirmPreflight();
  await expect(page.locator("#amount-error")).toContainText("$1,232.462");
  await expect(bridge.primaryButton()).toBeDisabled();
  expect(await bridge.readActivities()).toHaveLength(0);
  await expect(page).not.toHaveURL(/\/activity\//);

  await page.route("**/api/prices?**", (route) =>
    route.fulfill({ status: 502, json: { error: "Price unavailable" } }));
  await page.reload();
  await bridge.waitForReady();
  await bridge.fillAmount("0.01");
  await expect(page.locator("#amount-error")).toContainText("Current USD prices are unavailable");
  await expect(bridge.primaryButton()).toBeDisabled();
  ethPrice = "9990";
  await priceAccount(page, () => ethPrice);
  await page.getByRole("button", { name: "Retry balance check" }).click();
  await expect(bridge.primaryButton()).toBeEnabled();
  await expect(page.locator("#amount-error")).toHaveCount(0);

  await page.route("**/api/prices?**", (route) =>
    route.fulfill({ status: 502, json: { error: "Price unavailable" } }));
  await page.goto("/?provider=agglayer&mode=send");
  await bridge.waitForReady();
  await bridge.fillAmount("0.01");
  await expect(page.locator('.swap-box[data-side="source"] .fiat-amount')).toHaveText("—");
  await bridge.openPreflight();
  await expect(bridge.preflight()).toContainText("0.01 ETH");
  await bridge.cancelPreflight();

});

test("confirmation waits for settled prices before showing a cap warning", async ({ page }) => {
  await priceAccount(page, () => "9990");
  await page.goto("/?provider=xreserve&mode=receive");
  const bridge = new BridgePage(page);
  await bridge.waitForReady();
  await bridge.fillAmount("200");
  await bridge.openPreflight();

  const ethRequested = Promise.withResolvers<void>();
  const releaseEth = Promise.withResolvers<void>();
  await page.route("**/api/prices?**", async (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol");
    if (symbol === "ETH") {
      ethRequested.resolve();
      await releaseEth.promise;
    }
    const usdDecimal = symbol === "ETH" ? "10000" : "2";
    await route.fulfill({ json: { symbol, usd: Number(usdDecimal), usdDecimal, fetchedAt: Date.now() } });
  });

  try {
    await bridge.confirmPreflight();
    await ethRequested.promise;
    await expect(page.locator('.swap-box[data-side="source"] .fiat-amount')).toHaveText("$400.00");
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    // Sample this intermediate render immediately: retrying could outlast the
    // ETH request timeout and miss the mixed-price warning we are guarding.
    expect(await page.locator("#amount-error").count()).toBe(0);
    expect(await page.getByText(/checking.*(?:balance|limit)/i).count()).toBe(0);
    expect(await page.getByRole("status").filter({ hasText: /balance|limit/i }).count()).toBe(0);
  } finally {
    releaseEth.resolve();
  }

  // Once both prices settle, the $1,402 projected balance really is over cap.
  await expect(page.locator("#amount-error")).toContainText("$1,232.462");
  await expect(bridge.primaryButton()).toBeDisabled();
  expect(await bridge.readActivities()).toHaveLength(0);
  await bridge.fillAmount("100");
  await expect(bridge.primaryButton()).toBeEnabled();
  await expect(page.locator(".form-error")).toHaveCount(0);
});

test("an unpriced holding is skipped during review and final deposit verification", async ({ page }) => {
  await page.route("**/api/prices?**", (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol");
    return symbol === "ETH"
      ? route.fulfill({ status: 502, json: { error: "ETH price unavailable" } })
      : route.fulfill({ json: { symbol, usd: 1, usdDecimal: "1", fetchedAt: Date.now() } });
  });
  // Fulfill the public Arc reads before the injected extension receives the real deposit request.
  const abi = [...xReserveAbi, ...erc20Abi];
  await page.route("**/api/evm/arc-testnet/rpc", (route) => {
    const { id, method, params } = route.request().postDataJSON();
    if (method !== "eth_call" || params?.[0]?.to?.toLowerCase() === "0xca11bde05977b3631167028862be2a173976ca11") {
      return route.fulfill({ json: { jsonrpc: "2.0", id, error: { code: -32601, message: "Optional metadata unavailable" } } });
    }
    const { functionName } = decodeFunctionData({ abi, data: params[0].data });
    if (functionName === "depositToRemote") {
      return route.fulfill({ json: { jsonrpc: "2.0", id, result: "0x" } });
    }
    const values: Record<string, unknown> = {
      isRemoteDomainRegistered: true,
      getRemoteToken: arcRecipient(arcConfig().faucetId),
      balanceOf: 10_000_000_000n,
      allowance: 10_000_000_000n,
    };
    if (!(functionName in values)) throw new Error(`Unexpected Arc read: ${functionName}`);
    return route.fulfill({ json: {
      jsonrpc: "2.0", id,
      result: encodeFunctionResult({ abi, functionName, result: values[functionName] as never }),
    } });
  });
  await page.route("**/api/xreserve/status**", (route) =>
    route.fulfill({ status: 502, json: { error: "Tracking unavailable" } }));
  await page.goto("/?provider=xreserve&mode=receive");
  const bridge = new BridgePage(page);
  await bridge.waitForReady();

  // Only the priced 1 USDC holding counts, leaving $1,231.462 to deposit.
  await bridge.fillAmount("1232");
  await expect(page.locator("#amount-error")).toContainText("$1,232.462");
  await expect(bridge.primaryButton()).toBeDisabled();
  await bridge.fillAmount("1231.462");
  await expect(bridge.primaryButton()).toBeEnabled();
  await expect(page.locator("#amount-error")).toHaveCount(0);
  await expect(page.locator("#balance-cap-status")).toHaveCount(0);
  await expect(page.getByText(/\$1,232\.462/)).toHaveCount(0);

  respondToWallet(page, request => {
    expect(request.wallet).toBe("evm");
    expect(request.method).toBe("eth_sendTransaction");
    const tx = request.params[0] as { from: string; to: string; data: `0x${string}` };
    expect(tx.to.toLowerCase()).toBe(arcConfig().xReserve.toLowerCase());
    expect(Number(request.chainId)).toBe(5042002);
    expect(tx.from).toBe("0xE2E0000000000000000000000000000000000001");
    const call = decodeFunctionData({ abi: xReserveAbi, data: tx.data });
    expect(call.functionName).toBe("depositToRemote");
    expect(call.args).toEqual([
      1_000_000n, 10007, `0x${"00".repeat(16)}2d45bdf6e85b898144227de68b46c100`,
      "0x3600000000000000000000000000000000000000", 0n, "0x",
    ]);
    return { result: SOURCE_TX };
  });
  await bridge.fillAmount("1");
  await bridge.submit();
  await bridge.waitForActivityPage();
  const [activity] = await bridge.readActivities();
  expect(activity).toMatchObject({ provider: "xreserve", mode: "receive", amount: "1" });
  expect(activity.sourceTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
});
