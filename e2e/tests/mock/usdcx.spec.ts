import { expect, test, type Page } from "@playwright/test";
import { stubNetwork } from "../../fixtures/mock-network";
import { BridgePage } from "../../pages/bridge-page";
import { decodeFunctionData, encodeFunctionResult, erc20Abi, parseAbi } from "viem";
import { ARC, xReserveAbi } from "../../../src/bridge/providers/xreserve/config";
import { cctpAbi, cctpSource } from "../../../src/bridge/providers/xreserve/cctp-config";
import { arcRecipient } from "../../../src/bridge/providers/xreserve/deposit";

type BridgeFrame = { route: string; source: string; wallet: string };
type FrameWindow = typeof window & { bridgeFrames: BridgeFrame[] };

async function recordBridgeFrames(page: Page) {
  await page.addInitScript(() => {
    const frames: BridgeFrame[] = [];
    (window as FrameWindow).bridgeFrames = frames;
    // Observe every committed UI state, including flashes too short for a
    // Playwright visibility assertion to catch.
    new MutationObserver(() => {
      const route = document.querySelector(".selected-provider")?.textContent;
      if (!route) return;
      const frame = {
        route,
        source: document.querySelector('.swap-box-head [role="combobox"]')?.textContent
          ?? document.querySelector(".swap-box-head strong")?.textContent ?? "",
        wallet: document.querySelector('.panel-wallet[data-wallet="evm"] .wallet-button')?.getAttribute("aria-label") ?? "",
      };
      if (JSON.stringify(frame) !== JSON.stringify(frames.at(-1))) frames.push(frame);
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

async function bridgeFrames(page: Page) {
  return page.evaluate(() => (window as FrameWindow).bridgeFrames);
}

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
  await page.route("**/api/xreserve/withdrawal-quote", (route) => route.fulfill({ json: { ...route.request().postDataJSON(), fee: "16400", received: "1983601", expiresAt: Date.now() + 60000 } }));
  await page.route("**/api/xreserve/quote", (route) => route.fulfill({ json: {
    ...route.request().postDataJSON(), signedQuote: "0x1234", fee: "250000",
    issuedAt: Math.floor(Date.now() / 1000),
    expiry: { mode: "BLOCK_NUMBER", expiresAtBlock: 26247476, blockEstimatedAt: Math.floor(Date.now() / 1000) + 168 },
    expiresAt: Date.now() + 168000,
  } }));
  await page.route("**/api/xreserve/quote/validate", (route) => route.fulfill({
    json: { claimable: true, secondsRemaining: 120 },
  }));
  await page.route("**/api/evm/*/balance**", (route) => route.fulfill({
    json: { balance: "10.123456", balanceRaw: "10123456" },
  }));
});

test("Base simulation outages leave a readable error and a retryable, contained form", async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const abi = [...xReserveAbi, ...cctpAbi, ...erc20Abi, ...parseAbi(["function paused() view returns (bool)"])];
  let simulations = 0;
  await page.route("**/api/evm/*/rpc", async (route) => {
    const { id, method, params } = route.request().postDataJSON();
    // AppKit probes wallet metadata through Multicall independently of the
    // deposit. Keep that optional read offline without mocking its internals.
    if (params?.[0]?.to?.toLowerCase() === "0xca11bde05977b3631167028862be2a173976ca11") {
      return route.fulfill({ json: { jsonrpc: "2.0", id, error: { code: -32601, message: "Metadata unavailable" } } });
    }
    expect(method).toBe("eth_call");
    const { functionName } = decodeFunctionData({ abi, data: params[0].data });
    if (functionName === "depositForBurnWithHookAndFees") {
      simulations++;
      return route.fulfill({ status: 502, json: { jsonrpc: "2.0", id, error: {
        code: -32002, message: "Base Sepolia RPC is temporarily unavailable. Please retry shortly.",
      } } });
    }
    const values: Record<string, unknown> = {
      isRemoteDomainRegistered: true,
      getRemoteToken: arcRecipient(ARC.faucetId),
      paused: false,
      getFee: [250000n, cctpSource("base-sepolia").asset.address],
      balanceOf: 10000000n,
      allowance: 10000000n,
    };
    if (!(functionName in values)) throw new Error(`Unexpected read: ${functionName}`);
    const result = encodeFunctionResult({ abi, functionName, result: values[functionName] as never });
    return route.fulfill({ json: { jsonrpc: "2.0", id, result } });
  });
  await page.goto("/?provider=xreserve");
  const bridge = new BridgePage(page);
  await bridge.waitForReady();
  await bridge.setChain("Base Sepolia");
  await bridge.fillAmount("1");
  await bridge.submit();
  const error = page.locator(".swap-card > .form-error");
  await expect(error).toHaveText("Base Sepolia RPC is temporarily unavailable. Please retry shortly.");
  await expect(error).toHaveAttribute("role", "alert");
  expect(simulations).toBe(1);
  expect(await bridge.readActivities()).toHaveLength(0);
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("1");
  await expect(bridge.primaryButton()).toBeEnabled();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const card = await page.locator(".swap-card").boundingBox();
    expect(card!.width).toBeLessThanOrEqual(Math.min(548, width));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`base-outage-${width}.png`), fullPage: true, animations: "disabled" });
  }
  // Retrying returns to review, keeping the original amount and source chain.
  await bridge.openPreflight();
  await expect(bridge.preflight()).toContainText("Base Sepolia");
  await expect(bridge.preflight()).toContainText("1 USDCx");
});

test("unbroken quote errors wrap within the bridge card on desktop and mobile", async ({ page }) => {
  await page.route("**/api/xreserve/quote", (route) =>
    route.fulfill({ status: 502, json: { error: "x".repeat(240) } }));
  await page.goto("/?provider=xreserve");
  const bridge = new BridgePage(page);
  await bridge.waitForReady();
  await bridge.setChain("Base Sepolia");
  await bridge.fillAmount("1");
  await expect(page.locator(".swap-card > .form-error")).toHaveText("x".repeat(240));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const card = await page.locator(".swap-card").boundingBox();
    const error = await page.locator(".swap-card > .form-error").boundingBox();
    expect(card!.width).toBeLessThanOrEqual(Math.min(548, width));
    expect(error!.x + error!.width).toBeLessThanOrEqual(card!.x + card!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("USDCx joins the shared form with Arc balances, exact amounts and deposit review", async ({ page }, info) => {
  await recordBridgeFrames(page);
  await page.goto("/arc");
  await expect(page).toHaveURL(/provider=xreserve/);
  const bridge = new BridgePage(page);
  await bridge.waitForReady();
  await expect(bridge.selectedProvider()).toContainText("USDCx");
  await expect(page.locator(".mode-switch").getByRole("button", { name: "Withdraw", exact: true })).toBeEnabled();
  await expect(page.locator(".token-select-symbol")).toHaveText(["USDC", "USDCx"]);
  await expect(page.locator(".swap-box").first()).toContainText("Arc Testnet");
  await expect(page.locator(".swap-box").first()).toContainText("10.1234 USDC");
  await expect(page.getByRole("button", { name: "Arc Testnet wallet menu", exact: true })).toBeVisible();
  expect.soft((await bridgeFrames(page)).filter((frame) => !frame.route.includes("USDCx") || frame.source !== "Arc Testnet")).toEqual([]);
  // Single-asset chains still expose a real, keyboard-operable token selector.
  for (const symbol of ["USDC", "USDCx"]) {
    const selector = page.getByRole("button", { name: `${symbol} — change token`, exact: true });
    await selector.press("ArrowDown");
    const options = page.getByRole("listbox", { name: "Token", exact: true }).getByRole("option");
    await expect(options).toHaveCount(1);
    await expect(options).toContainText(symbol);
    const search = page.getByRole("searchbox", { name: "Search tokens by name or symbol" });
    await expect(search).toBeFocused();
    await search.press("ArrowDown");
    await expect(options).toBeFocused();
    await options.press("Enter");
    await expect(selector).toBeFocused();
  }
  const origin = page.getByRole("combobox", { name: "Origin chain", exact: true });
  await expect(origin).toHaveText("Arc Testnet");
  await expect(page.locator(".swap-box").last().getByRole("combobox")).toHaveCount(0);
  await expect(page.locator(".swap-box").last().locator(".swap-box-head strong")).toHaveText("Miden");
  // A chain change resolves a supported route and clears the old amount. Token
  // menus stay on that chain, so selecting an asset cannot move it implicitly.
  await bridge.fillAmount("1.000001");
  await origin.press("ArrowDown");
  await page.getByRole("option", { name: "Arc Testnet", exact: true }).press("Home");
  const sepolia = page.getByRole("option", { name: "Sepolia", exact: true });
  await expect(sepolia).toBeFocused();
  await sepolia.press("Enter");
  await expect(origin).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Sepolia wallet menu", exact: true })).toBeVisible();
  await expect(page.locator(".token-select-symbol")).toHaveText(["USDC", "USDCx"]);
  // Sepolia offers other providers' tokens; the USDCx route retains Circle USDC.
  await page.getByRole("button", { name: "USDC — change token", exact: true }).click();
  const tokens = page.getByRole("listbox", { name: "Token", exact: true });
  await expect(tokens.getByRole("option", { name: "ETH Ether", exact: true })).toBeEnabled();
  await expect(tokens.getByRole("option", { name: "USDC Circle USDC", exact: true })).toHaveAttribute("aria-selected", "true");
  const search = page.getByRole("searchbox", { name: "Search tokens by name or symbol" });
  await expect(search).toBeFocused();
  await search.fill("usdc");
  await expect(tokens.getByRole("option")).toHaveText(["USDCEpoch test USDC", "USDCCircle USDC"]);
  await search.fill("  cIrClE  ");
  await expect(tokens.getByRole("option")).toHaveText(["USDCCircle USDC"]);
  await search.fill("unknown-token");
  await expect(tokens.getByRole("option")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "No tokens found" })).toBeVisible();
  await search.press("ArrowDown");
  await expect(search).toBeFocused();
  await search.fill("ether");
  await search.press("ArrowUp");
  await expect(tokens.getByRole("option", { name: "ETH Ether", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "USDC — change token", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(tokens.getByRole("option", { name: "ETH Ether", exact: true })).toBeVisible();
  await expect(tokens.getByRole("option", { name: "USDC Circle USDC", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".mode-switch").getByRole("button", { name: "Withdraw", exact: true })).toBeEnabled();
  await bridge.setChain("Arc Testnet");
  await expect(page.locator(".token-select-symbol")).toHaveText(["USDC", "USDCx"]);
  await expect(page.getByRole("button", { name: "Arc Testnet wallet menu", exact: true })).toBeVisible();
  expect.soft((await bridgeFrames(page)).filter((frame) => /wrong network/i.test(frame.wallet))).toEqual([]);

  // Reopening without a launch URL must restore the saved route on its first
  // frame too, not briefly paint the default Sepolia form.
  await page.goto("/");
  await bridge.waitForReady();
  await expect(page.getByRole("button", { name: "Arc Testnet wallet menu", exact: true })).toBeVisible();
  expect((await bridgeFrames(page)).filter((frame) => !frame.route.includes("USDCx") || frame.source !== "Arc Testnet" || /wrong network/i.test(frame.wallet))).toEqual([]);

  await bridge.fillAmount("1.000001");
  await bridge.openPreflight();
  await expect(bridge.preflight()).toContainText("1.000001 USDCx");
  await expect(bridge.preflight()).toContainText("Arc Testnet");
  await expect(bridge.preflight()).not.toContainText("Sepolia");
  await bridge.cancelPreflight();

  await bridge.fillAmount("1.0000001");
  await expect(bridge.primaryButton()).toBeDisabled();
  await expect(bridge.preflight()).toBeHidden();
  await expect(page.locator(".form-error").filter({ hasText: "6 decimal places" })).toBeVisible();
  await bridge.fillAmount("1.000001");
  // Valid input restores review, including its focus-return behavior.
  await bridge.openPreflight();
  await bridge.cancelPreflight();
  await expect(bridge.primaryButton()).toBeFocused();
  await page.getByRole("button", { name: "USDC — change token", exact: true }).click();
  await page.screenshot({ path: info.outputPath("usdcx-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("usdcx-mobile.png"), fullPage: true, animations: "disabled" });
});

test("a saved deposit resumes tracking after reload without claiming delivery during an outage", async ({ page }, info) => {
  const hash = `0x${"ab".repeat(32)}`;
  const recipient = "0x4e6fb40fd2f6a55140df2c42dfb5b7";
  let unavailable = false;
  let statusReads = 0;
  await page.route("**/api/xreserve/status**", (route) => {
    statusReads++;
    return unavailable
      ? route.fulfill({ status: 502, json: { error: "Arc status unavailable. Tracking will retry." } })
      : route.fulfill({ json: {
        status: "confirmed", sourceTxAt: 1791456556000,
        deposit: { amount: "1000001", recipient, sender: `0x${"12".repeat(20)}`, faucet: "0x4cbdcaffe75f0a317482224dae6436" },
      } });
  });
  await page.goto("/?provider=xreserve");
  await page.evaluate(({ hash, recipient }) => {
    localStorage.setItem("miden.bridge.ui.activities", JSON.stringify([{
      id: "act-usdcx", provider: "xreserve", routeId: "xreserve-usdc-to-miden", mode: "receive",
      amount: "1.000001", asset: "USDC", receivedAmount: "1.000001", status: "source_finality",
      summary: "Receive 1.000001 USDCx on Miden", eta: "Delivery time varies",
      sourceTxHash: hash, txHash: hash, sourceTxAt: 1791456556000,
      destination: recipient, midenAccountHex: recipient, evmAddress: `0x${"12".repeat(20)}`,
      updatedAt: Date.now(), xreserveStatus: "submitted",
    }]));
  }, { hash, recipient });
  await page.goto("/activity/act-usdcx");
  const receipt = page.getByRole("article", { name: "Transfer receipt" });
  await expect(receipt).toContainText("Arc Testnet tx");
  await expect(receipt).toContainText("1.000001 USDCx");
  await expect(receipt.getByRole("link", { name: /Arc explorer/i })).toHaveAttribute("href", `https://explorer.testnet.arc.io/tx/${hash}`);
  await expect(receipt.getByText("Miden note", { exact: true }).locator("..")).toContainText("Pending");
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("miden.bridge.ui.activities")!)[0]);
  await expect.poll(async () => (await stored()).xreserveStatus).toBe("confirmed");

  unavailable = true;
  const previousReads = statusReads;
  await page.reload();
  await expect.poll(() => statusReads).toBeGreaterThan(previousReads);
  await expect(page.getByText("Arc status unavailable. Tracking will retry.", { exact: true })).toBeVisible();
  expect(await stored()).toMatchObject({ status: "source_finality", xreserveStatus: "confirmed" });
  await page.screenshot({ path: info.outputPath("usdcx-tracking.png"), fullPage: true });
});

test("Circle origins retain Miden USDCx, review the separate fee and restore the chosen chain", async ({ page }, info) => {
  await recordBridgeFrames(page);
  await page.goto("/?provider=xreserve");
  const bridge = new BridgePage(page);
  await bridge.waitForReady();
  const origin = page.getByRole("combobox", { name: "Origin chain", exact: true });
  for (const label of ["Sepolia", "Base Sepolia", "Arbitrum Sepolia"]) {
    await bridge.setChain(label);
    await expect(page.locator(".token-select-symbol")).toHaveText(["USDC", "USDCx"]);
    await expect(page.locator(".swap-box").last().locator(".swap-box-head strong")).toHaveText("Miden");
    await bridge.fillAmount("1");
    await expect(page.locator(".quote-summary")).toContainText("0.25 USDC");
    await bridge.openPreflight();
    await expect(bridge.preflight()).toContainText(label);
    await expect(bridge.preflight()).toContainText("1 USDCx");
    await expect(bridge.preflight()).toContainText("1.25 USDC");
    await bridge.cancelPreflight();
  }
  // Reload the launch URL too: its provider must not reset the selected origin.
  await page.reload();
  await bridge.waitForReady();
  await expect(origin).toHaveText("Arbitrum Sepolia");
  await page.goto("/");
  await bridge.waitForReady();
  await expect(origin).toHaveText("Arbitrum Sepolia");
  expect((await bridgeFrames(page)).filter((frame) => frame.source !== "Arbitrum Sepolia" || !frame.route.includes("USDCx"))).toEqual([]);
  await bridge.fillAmount("1");
  await expect(page.locator(".quote-summary")).toContainText("0.25 USDC");
  await page.screenshot({ path: info.outputPath("usdcx-origins-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("usdcx-origins-mobile.png"), fullPage: true, animations: "disabled" });
  await bridge.fillAmount("10");
  await expect(bridge.primaryButton()).toBeDisabled();
});

test("browsing routes leaves the wallet alone; confirming switches chains and a rejection can be retried", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("e2e-signer-mode", "reject"));
  // A successful switch reaches the deposit's first on-chain check. Stop there
  // so this test exercises network selection without signing a deposit.
  let arcReads = 0;
  await page.route("**/api/evm/arc-testnet/rpc", (route) => {
    arcReads++;
    const { id } = route.request().postDataJSON();
    return route.fulfill({ json: { jsonrpc: "2.0", id, result: `0x${"00".repeat(32)}` } });
  });
  await page.goto("/?provider=xreserve");
  const bridge = new BridgePage(page);
  await bridge.waitForReady();
  await bridge.setChain("Sepolia");
  await bridge.setChain("Arc Testnet");
  await bridge.fillAmount("1.000001");
  await expect(page.locator(".form-error")).toHaveCount(0);
  await bridge.openPreflight();
  expect(arcReads).toBe(0);
  await bridge.cancelPreflight();
  await expect(page.locator(".form-error")).toHaveCount(0);
  await bridge.openPreflight();
  await bridge.confirmPreflight();
  await expect(page.locator(".form-error").filter({ hasText: /cancelled/i })).toBeVisible();
  expect(arcReads).toBe(0);
  await expect(bridge.selectedProvider()).toContainText("USDCx");
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("1.000001");
  await page.evaluate(() => localStorage.setItem("e2e-signer-mode", "sign"));
  await bridge.openPreflight();
  await bridge.confirmPreflight();
  await expect(page.locator(".form-error")).toContainText("Miden deposits are not registered");
  expect(arcReads).toBeGreaterThan(0);
});


test("USDCx withdrawals restore the destination and show the net payout estimate and Circle fee", async ({ page }) => {
  await page.goto("/?provider=xreserve&mode=send");
  const bridge = new BridgePage(page);
  await bridge.waitForReady();
  await expect(page.locator(".token-select-symbol")).toHaveText(["USDCx", "USDC"]);
  const destinationChain = page.getByRole("combobox", { name: "Destination chain", exact: true });
  await bridge.setChain("Base Sepolia");
  await page.reload();
  await bridge.waitForReady();
  await expect(destinationChain).toHaveText("Base Sepolia");
  await bridge.fillAmount("2.000001");
  await bridge.openPreflight();
  await expect(bridge.preflight()).toContainText("2.000001 USDCx");
  await expect(bridge.preflight()).toContainText("1.983601 USDC");
  await expect(bridge.preflight()).toContainText("0.0164 USDC (estimated)");
  await expect(bridge.preflight().getByText("Minimum received", { exact: true })).toHaveCount(0);
  await expect(bridge.preflight().locator(".fiat-amount")).toHaveText("$2.00");
  await expect(page.locator("#preflight-source-value")).toHaveAttribute("title", await page.evaluate(() => window.__E2E__!.midenAddress!));
  await expect(page.locator("#preflight-destination-value")).toHaveAttribute("title", await page.evaluate(() => window.__E2E__!.evmAddress!));
  await expect(bridge.preflight()).toContainText("Burning USDCx is irreversible");
});
