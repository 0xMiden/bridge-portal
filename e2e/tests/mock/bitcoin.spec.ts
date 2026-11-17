import { test, expect, type Page } from "@playwright/test";
import { installWallets, walletRequests } from "../../fixtures/wallets";
import { stubNetwork } from "../../fixtures/mock-network";
import { connectBitcoinWallet, installBitcoinWallet, selectBitcoinRoute } from "../../fixtures/bitcoin-wallet";
import fixtures from "../../../test/fixtures/near-bitcoin.json";

const { receive: { preview, prepared }, send: { preview: sendPreview, prepared: sendPrepared } } = fixtures;

async function openBitcoinReview(page: Page, mode: "receive" | "send") {
  const quote = mode === "receive" ? prepared : sendPrepared;
  await installWallets(page, { mainnetAssets: [
    { faucetId: "0x3084d3c389ececd15fda9770d18c8a", amount: "1000000" },
    { faucetId: "0xe69e6ca6e39df1b10c1e5399399feb", amount: "10000" },
  ] });
  await stubNetwork(page);
  await installBitcoinWallet(page, mode === "receive" ? quote.quoteRequest.refundTo : quote.quoteRequest.recipient);
  await page.clock.install({ time: new Date(quote.timestamp) });
  await selectBitcoinRoute(page, mode);
  await page.route("**/api/near/quote", route => route.fulfill({ json: mode === "receive" ? preview : sendPreview }));
  await page.route("**/api/near/prepare", route => route.fulfill({ json: quote }));
  await page.route("**/api/prices?**", route => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol");
    const usd = symbol === "BTC" || symbol === "WBTC" ? 74293 : 1;
    return route.fulfill({ json: { symbol, usd, usdDecimal: String(usd), fetchedAt: Date.parse(quote.timestamp) } });
  });
  await page.goto("/");
  await page.locator('[data-wallet="miden"] .wallet-pill').click();
  await page.getByRole("menuitem", { name: "Connect wallet", exact: true }).click();
  await connectBitcoinWallet(page);
  await page.getByRole("textbox", { name: "Amount", exact: true }).fill("0.001");
  await expect(page.getByRole("button", { name: "Review transfer", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Review transfer", exact: true }).click();
  const review = page.getByRole("dialog");
  await expect(review.getByRole("button", { name: "Confirm in wallet" })).toBeEnabled();
  return review;
}

for (const mode of ["receive", "send"] as const) {
  test(`Bitcoin ${mode} invalidates review on account change and blocks non-mainnet accounts`, async ({ page }) => {
    const review = await openBitcoinReview(page, mode);
    await page.evaluate(() => window.testBitcoinWallet.changeAccounts(["3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"]));
    await expect(review.getByRole("alert")).toHaveText("Your connected wallet changed. Close this review and review the transfer again.");
    await expect(review.getByRole("button", { name: "Confirm in wallet" })).toBeDisabled();
    await review.getByRole("button", { name: "Cancel review" }).click();
    await page.evaluate(() => window.testBitcoinWallet.changeAccounts(["mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn"]));
    await expect(page.getByRole("region", { name: "Miden bridge", exact: true }).getByRole("alert"))
      .toContainText("Connect a Bitcoin mainnet payment account.");
    await expect(page.getByRole("button", { name: "Review transfer", exact: true })).toHaveCount(0);
    await page.evaluate(() => window.testBitcoinWallet.changeAccounts([]));
    await expect(page.locator('[data-wallet="bitcoin"]').getByRole("button", { name: "Connect Bitcoin wallet", exact: true })).toBeVisible();
    expect(await walletRequests(page)).toEqual([]);
  });
}

test("a silent UniSat chain change with the same payment address stops the deposit", async ({ page }) => {
  const review = await openBitcoinReview(page, "receive");
  await page.evaluate(() => window.testBitcoinWallet.changeChain("FRACTAL_BITCOIN_MAINNET"));
  await review.getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(page.getByRole("region", { name: "Miden bridge", exact: true }).getByRole("alert"))
    .toContainText("Switch your wallet to Bitcoin mainnet");
  expect(await walletRequests(page)).toEqual([]);
});
