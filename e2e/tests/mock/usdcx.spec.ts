import { expect, test, type Page } from "@playwright/test";
import { stubNetwork } from "../../fixtures/mock-network";
import { BridgePage } from "../../pages/bridge-page";

type BridgeFrame = { route: string; source: string; wallet: string };
type FrameWindow = typeof window & { bridgeFrames: BridgeFrame[] };

async function recordBridgeFrames(page: Page) {
  await page.addInitScript(() => {
    const frames: BridgeFrame[] = [];
    (window as FrameWindow).bridgeFrames = frames;
    // Observe every committed UI state, including flashes too short for a
    // Playwright visibility assertion to catch.
    new MutationObserver(() => {
      const route = document.querySelector(".route-trigger")?.textContent;
      if (!route) return;
      const frame = {
        route,
        source: document.querySelector<HTMLSelectElement>(".swap-box-head select")?.selectedOptions[0]?.textContent
          ?? document.querySelector(".swap-box-head strong")?.textContent ?? "",
        wallet: document.querySelector(".wallet-cluster .wallet-button")?.getAttribute("aria-label") ?? "",
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
  await page.route("**/api/xreserve/quote", (route) => route.fulfill({ json: { ...route.request().postDataJSON(), signedQuote: "0x1234", fee: "250000", expiresAt: Date.now() + 120000 } }));
  await page.route("**/api/evm/*/balance**", (route) => route.fulfill({
    json: { balance: "10.123456", balanceRaw: "10123456" },
  }));
});

test("USDCx joins the shared form with Arc balances, exact amounts and deposit-only review", async ({ page }, info) => {
  await recordBridgeFrames(page);
  await page.goto("/arc");
  await expect(page).toHaveURL(/provider=xreserve/);
  const bridge = new BridgePage(page);
  await bridge.waitForReady();
  await expect(bridge.routeTrigger()).toContainText("USDCx");
  await expect(page.locator(".mode-switch").getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await expect(page.locator(".token-select-symbol")).toHaveText(["USDC", "USDCx"]);
  await expect(page.locator(".swap-box").first()).toContainText("Arc Testnet");
  await expect(page.locator(".swap-box").first()).toContainText("10.1234 USDC");
  await expect(page.getByRole("button", { name: "Arc Testnet wallet menu", exact: true })).toBeVisible();
  expect.soft((await bridgeFrames(page)).filter((frame) => !frame.route.includes("USDCx") || frame.source !== "Arc Testnet")).toEqual([]);
  const origin = page.getByRole("combobox", { name: "Origin chain", exact: true });
  await expect(origin).toHaveValue("arc-testnet");
  await expect(page.locator(".swap-box").last().getByRole("combobox")).toHaveCount(0);
  await expect(page.locator(".swap-box").last().locator(".swap-box-head strong")).toHaveText("Miden");
  // A chain change resolves a supported route and clears the old amount. Token
  // menus stay on that chain, so selecting an asset cannot move it implicitly.
  await bridge.fillAmount("1.000001");
  await origin.selectOption("sepolia");
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Sepolia wallet menu", exact: true })).toBeVisible();
  await expect(page.locator(".token-select-symbol")).toHaveText(["USDC", "USDCx"]);
  // Paused providers must not appear as selectable tokens on Sepolia.
  await expect(page.locator(".token-select").getByRole("button")).toHaveCount(0);
  await expect(page.locator(".mode-switch").getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await origin.selectOption("arc-testnet");
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
  await bridge.primaryButton().click();
  await expect(bridge.preflight()).toBeHidden();
  await expect(page.locator(".form-error").filter({ hasText: "6 decimal places" })).toBeVisible();
  await bridge.fillAmount("1.000001");
  // Clear validation feedback by reopening and closing the valid review.
  await bridge.openPreflight();
  await bridge.cancelPreflight();
  await expect(bridge.primaryButton()).toBeFocused();
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
  await expect(receipt.locator(".rcpt-meta > div").filter({ hasText: "Miden time" })).toContainText("—");
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
  for (const [network, label] of [["sepolia", "Sepolia"], ["base-sepolia", "Base Sepolia"], ["arbitrum-sepolia", "Arbitrum Sepolia"]]) {
    await origin.selectOption(network);
    await expect(page.locator(".token-select-symbol")).toHaveText(["USDC", "USDCx"]);
    await expect(page.locator(".swap-box").last().locator(".swap-box-head strong")).toHaveText("Miden");
    await bridge.fillAmount("1");
    await bridge.fillDestination("0x4e6fb40fd2f6a55140df2c42dfb5b7");
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
  await expect(origin).toHaveValue("arbitrum-sepolia");
  await page.goto("/");
  await bridge.waitForReady();
  await expect(origin).toHaveValue("arbitrum-sepolia");
  expect((await bridgeFrames(page)).filter((frame) => frame.source !== "Arbitrum Sepolia" || !frame.route.includes("USDCx"))).toEqual([]);
  await bridge.fillAmount("1");
  await bridge.fillDestination("0x4e6fb40fd2f6a55140df2c42dfb5b7");
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
  await page.getByRole("combobox", { name: "Origin chain", exact: true }).selectOption("sepolia");
  await page.getByRole("combobox", { name: "Origin chain", exact: true }).selectOption("arc-testnet");
  await bridge.fillAmount("1.000001");
  await bridge.fillDestination("0x4e6fb40fd2f6a55140df2c42dfb5b7");
  await expect(page.locator(".form-error")).toHaveCount(0);
  await bridge.openPreflight();
  expect(arcReads).toBe(0);
  await bridge.cancelPreflight();
  await expect(page.locator(".form-error")).toHaveCount(0);
  await bridge.openPreflight();
  await bridge.confirmPreflight();
  await expect(page.locator(".form-error").filter({ hasText: /cancelled/i })).toBeVisible();
  expect(arcReads).toBe(0);
  await expect(bridge.routeTrigger()).toContainText("USDCx");
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("1.000001");
  await page.evaluate(() => localStorage.setItem("e2e-signer-mode", "sign"));
  await bridge.openPreflight();
  await bridge.confirmPreflight();
  await expect(page.locator(".form-error")).toContainText("Miden deposits are not registered");
  expect(arcReads).toBeGreaterThan(0);
});
