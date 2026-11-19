import { test, expect, type Page } from "@playwright/test";
import { installWallets, respondToWallet, SOURCE_TX, walletRequests, type WalletRequest } from "../../fixtures/wallets";
import { stubNetwork } from "../../fixtures/mock-network";
import { connectBitcoinWallet, installBitcoinWallet, selectBitcoinRoute } from "../../fixtures/bitcoin-wallet";
import { browserMidenSdk } from "../../../test/miden-sdk";
import fixtures from "../../../test/fixtures/near-bitcoin.json";

const { receive: { preview, prepared }, send: { preview: sendPreview, prepared: sendPrepared },
  midenBlockHeader: blockHeader } = fixtures;

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

test("Bitcoin deposit requests exact satoshis through Reown once and tracks delivery after reload", async ({ page }) => {
  await installWallets(page);
  await stubNetwork(page);
  await installBitcoinWallet(page, prepared.quoteRequest.refundTo);
  await page.clock.install({ time: new Date(prepared.timestamp) });
  // Public route preferences select the same route as the chain picker.
  await selectBitcoinRoute(page, "receive");
  let allocations = 0;
  let detected = false;
  let delivered = false;
  await page.route("**/api/near/quote", route => route.fulfill({ json: preview }));
  await page.route("**/api/near/prepare", route => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ externalAddress: prepared.quoteRequest.refundTo, midenAccount: prepared.quoteRequest.recipient });
    if (!body.quote) allocations++;
    return route.fulfill({ json: prepared });
  });
  await page.route("**/api/near/status", route => route.fulfill({ json: {
    correlationId: "bitcoin-browser-status", quoteResponse: prepared,
    status: delivered ? "SUCCESS" : detected ? "KNOWN_DEPOSIT_TX" : "PENDING_DEPOSIT",
    updatedAt: new Date(prepared.timestamp).toISOString(),
    swapDetails: { originChainTxHashes: detected ? [{ hash: "ab".repeat(32) }] : [],
      destinationChainTxHashes: delivered ? [{ hash: `0x${"cd".repeat(32)}` }] : [], amountOut: delivered ? "98248" : null },
  } }));
  await page.route("**/api/near/deposit/submit", route => {
    expect(route.request().postDataJSON()).toMatchObject({ quote: prepared, txHash: "ab".repeat(32) });
    return route.fulfill({ json: {} });
  });
  const requests: WalletRequest[] = [];
  respondToWallet(page, async request => {
    requests.push(request);
    // UniSat's API takes integer satoshis, not a decimal BTC amount.
    expect(request).toEqual({ wallet: "bitcoin", method: "sendBitcoin", params: [prepared.quote.depositAddress, 100000] });
    const receipts = await page.evaluate(() => JSON.parse(localStorage.getItem("miden.bridge.ui.activities.v3") ?? "[]"));
    expect(receipts).toMatchObject([{ near: { submission: "attempted", quote: prepared } }]);
    return { result: "ab".repeat(32) };
  });
  await page.route("**/api/prices?**", route => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol");
    return route.fulfill({ json: { symbol, usd: 74293, usdDecimal: "74293", fetchedAt: Date.parse(prepared.timestamp) } });
  });
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Origin chain" })).toContainText("Bitcoin");
  await expect(page.locator('[data-wallet="evm"]')).toHaveCount(0);
  const miden = page.locator('[data-wallet="miden"] .wallet-pill');
  await miden.click();
  await page.getByRole("menuitem", { name: "Connect wallet", exact: true }).click();
  await expect(miden).toHaveAttribute("data-connected", "true");
  await connectBitcoinWallet(page);

  await page.getByRole("textbox", { name: "Amount", exact: true }).fill("0.001");
  await page.getByRole("button", { name: "Review transfer", exact: true }).click();
  const review = page.getByRole("dialog");
  await expect(review).toContainText(prepared.quoteRequest.refundTo);
  await expect(review).toContainText("Refund to");
  await review.getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(page).toHaveURL(/\/activity\//);
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({ wallet: "bitcoin", method: "sendBitcoin", params: [prepared.quote.depositAddress, 100000] });
  await expect(page.getByRole("link", { name: "View on mempool.space" })).toHaveAttribute("href", `https://mempool.space/tx/${"ab".repeat(32)}`);
  expect(allocations).toBe(1);

  await page.reload();
  await expect(page.getByRole("link", { name: "View on mempool.space" })).toHaveAttribute("href", `https://mempool.space/tx/${"ab".repeat(32)}`);
  expect(allocations).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // Tracking remains available after the original deposit window expires.
  await page.clock.fastForward(61 * 60_000);
  detected = true;
  await page.getByRole("button", { name: "Refresh status", exact: true }).click();
  await expect(page.getByRole("link", { name: "View on mempool.space" })).toHaveAttribute("href", `https://mempool.space/tx/${"ab".repeat(32)}`);
  delivered = true;
  await expect(page.getByText("Complete", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View on Midenscan" })).toBeEnabled();
  expect(allocations).toBe(1);
  expect(await walletRequests(page)).toEqual([]);
  expect(requests).toHaveLength(1);
});

test("Bitcoin withdrawal reviews the recipient, funds once through Bread and resumes delivery after reload", async ({ page }) => {
  const faucetId = "0x3084d3c389ececd15fda9770d18c8a";
  await installWallets(page, { mainnetAssets: [
    { faucetId, amount: "1000000" },
    { faucetId: "0xe69e6ca6e39df1b10c1e5399399feb", amount: "10000" },
  ] });
  await stubNetwork(page);
  await installBitcoinWallet(page, sendPrepared.quoteRequest.recipient);
  await page.clock.install({ time: new Date(sendPrepared.timestamp) });
  await selectBitcoinRoute(page, "send");
  // Replay a real gRPC-web header so the production SDK decodes the network fee.
  await page.route(blockHeader.source, route => route.fulfill({
    contentType: "application/grpc-web+proto", body: Buffer.from(blockHeader.bodyBase64, "base64"),
    headers: { "grpc-status": "0", "access-control-allow-origin": "*", "access-control-expose-headers": "grpc-status,grpc-message" },
  }));
  let allocations = 0;
  let funded = false;
  let delivered = false;
  await page.route("**/api/near/quote", route => route.fulfill({ json: sendPreview }));
  await page.route("**/api/near/prepare", route => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ routeId: "mainnet:near-miden-wbtc-to-bitcoin-btc", mode: "send", amount: "0.001",
      externalAddress: sendPrepared.quoteRequest.recipient, midenAccount: sendPrepared.quoteRequest.refundTo });
    if (!body.quote) allocations++;
    else expect(body.quote).toEqual(sendPrepared);
    return route.fulfill({ json: sendPrepared });
  });
  await page.route("**/api/near/deposit/submit", route => {
    expect(route.request().postDataJSON()).toMatchObject({ quote: sendPrepared, txHash: SOURCE_TX });
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/near/status", route => {
    expect(route.request().postDataJSON()).toMatchObject({ quote: sendPrepared });
    return route.fulfill({ json: {
      correlationId: "bitcoin-withdrawal-browser-status", quoteResponse: sendPrepared,
      status: delivered ? "SUCCESS" : funded ? "KNOWN_DEPOSIT_TX" : "PENDING_DEPOSIT", updatedAt: sendPrepared.timestamp,
      swapDetails: { originChainTxHashes: funded ? [{ hash: SOURCE_TX }] : [],
        destinationChainTxHashes: delivered ? [{ hash: "cd".repeat(32) }] : [], amountOut: delivered ? "97848" : null },
    } });
  });
  const sdk = await browserMidenSdk();
  const requests: WalletRequest[] = [];
  let outputNote: string;
  respondToWallet(page, async request => {
    requests.push(request);
    expect(request.wallet).toBe("miden");
    if (request.method === "requestTransaction") {
      const transaction = request.params[0] as { type: string; payload: { transactionRequest: string } };
      expect(transaction).toMatchObject({ type: "custom", payload: {
        address: sendPrepared.quoteRequest.refundTo, recipientAddress: sendPrepared.quote.depositAddress,
      } });
      const notes = sdk.TransactionRequest.deserialize(Buffer.from(transaction.payload.transactionRequest, "base64")).expectedOutputOwnNotes();
      expect(notes).toHaveLength(1);
      expect(notes[0].metadata().noteType()).toBe(sdk.NoteType.Public);
      expect(notes[0].assets().fungibleAssets().map(asset => [asset.faucetId().toString(), asset.amount()])).toEqual([[faucetId, 100000n]]);
      const receipts = await page.evaluate(() => JSON.parse(localStorage.getItem("miden.bridge.ui.activities.v3") ?? "[]"));
      expect(receipts).toMatchObject([{ midenNoteId: notes[0].id().toString(), near: { submission: "attempted", quote: sendPrepared } }]);
      outputNote = Buffer.from(notes[0].serialize()).toString("base64");
      return { result: { transactionId: "bitcoin-withdrawal-request" } };
    }
    expect(request.method).toBe("waitForTransaction");
    expect(request.params).toEqual(["bitcoin-withdrawal-request"]);
    funded = true;
    return { result: { txHash: SOURCE_TX, outputNotes: [outputNote] } };
  });

  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Destination chain" })).toContainText("Bitcoin");
  await expect(page.locator('[data-wallet="evm"]')).toHaveCount(0);
  const miden = page.locator('[data-wallet="miden"] .wallet-pill');
  await miden.click();
  await page.getByRole("menuitem", { name: "Connect wallet", exact: true }).click();
  await expect(miden).toHaveAttribute("data-connected", "true");
  await connectBitcoinWallet(page);
  await page.getByRole("textbox", { name: "Amount", exact: true }).fill("0.001");
  await page.getByRole("button", { name: "Review transfer", exact: true }).click();
  const review = page.getByRole("dialog");
  await expect(review).toContainText(sendPrepared.quoteRequest.recipient);
  await review.getByRole("button", { name: "Confirm in wallet", exact: true }).click();
  await expect.poll(() => requests.map(request => request.method)).toEqual(["requestTransaction", "waitForTransaction"]);
  await expect(page).toHaveURL(/\/activity\//);
  await expect(page.getByRole("link", { name: "View on Midenscan" })).toHaveAttribute("href", new RegExp(SOURCE_TX));
  const receiptUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(receiptUrl);
  await expect(page.getByRole("link", { name: "View on Midenscan" })).toHaveAttribute("href", new RegExp(SOURCE_TX));
  delivered = true;
  await expect(page.getByText("Complete", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View on mempool.space" })).toHaveAttribute("href", `https://mempool.space/tx/${"cd".repeat(32)}`);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("miden.bridge.ui.activities.v3") ?? "[]")))
    .toMatchObject([{ receivedAmount: "0.00097848", near: { quote: sendPrepared, submission: "confirmed", status: "SUCCESS" } }]);
  expect(allocations).toBe(1);
  expect(requests.map(request => request.method)).toEqual(["requestTransaction", "waitForTransaction"]);
});
