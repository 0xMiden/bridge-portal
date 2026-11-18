import { test, expect } from "../../fixtures/bridge";
import { decodeFunctionData, encodeFunctionResult, parseUnits, type Address, type Hex } from "viem";
import { createActivity } from "../../../src/app/lib/bridge-presentation";
import { findBridgeRoute } from "../../../src/bridge/core/routes";
import { legacyRecoveryLock, recoveryAbi, recoveryAssets } from "../../../src/bridge/providers/epoch/recovery";
import { EVM_ADDRESS, respondToWallet, SOURCE_TX, walletRequests } from "../../fixtures/wallets";

test("Recovery opens the funded lock from a saved deposit while the allocator is offline", async ({ bridge, page }) => {
  const route = findBridgeRoute("epoch-test-usdc-to-miden")!;
  const compactAddress = "0x2222222222222222222222222222222222222222";
  const id = BigInt("0x580000000000000000000abc2bb4ffd7e2c6d432b697554efd77fa13bdbefd69");
  const activity = createActivity(route, "0.45", { sourceTxHash: SOURCE_TX, epochSponsor: EVM_ADDRESS,
    epochDepositId: id.toString(), epochCompactAddress: compactAddress, status: "source_finality" });
  await page.evaluate(receipt => {
    localStorage.setItem("miden.bridge.ui.activities.v2", JSON.stringify([receipt]));
  }, activity);
  await page.route("**/api/evm/sepolia/rpc", async route => {
    const { id: requestId, method, params } = route.request().postDataJSON();
    if (method !== "eth_call" || params[0]?.to?.toLowerCase() !== compactAddress) return route.fallback();
    const call = decodeFunctionData({ abi: recoveryAbi, data: params[0].data });
    expect(call.args).toEqual([expect.stringMatching(new RegExp(`^${EVM_ADDRESS}$`, "i")), id]);
    if (call.functionName !== "balanceOf") return route.fallback();
    const result = encodeFunctionResult({ abi: recoveryAbi, functionName: "balanceOf", result: parseUnits("0.45", 18) });
    return route.fulfill({ json: { jsonrpc: "2.0", id: requestId, result } });
  });
  await page.goto("/recovery");
  const savedDeposit = page.getByRole("button", { name: /0\.45 USDC.*Sepolia/ });
  await expect(savedDeposit).toBeVisible();
  await savedDeposit.click();
  const detail = page.getByRole("region", { name: "Deposit details" });
  await expect(detail.getByRole("heading", { name: "0.45 USDC", exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Start withdrawal", exact: true })).toBeEnabled();
});

test("Recovery opens and refreshes individual on-chain deposits", async ({ bridge, page }, info) => {
  await bridge.waitForReady();
  const assets = recoveryAssets("testnet");
  const asset = assets.find(token => token.symbol === "USDC");
  const otherAsset = assets.find(token => token.symbol === "WBTC");
  if (!asset || !otherAsset) throw new Error("Missing Epoch deposit fixtures");
  const { id, compactAddress } = legacyRecoveryLock(asset, "testnet");
  const { id: otherId } = legacyRecoveryLock(otherAsset, "testnet");
  let status = 0;
  let deadline = 0n;
  let balance = parseUnits("1.23456789", asset.decimals);
  let otherBalance = parseUnits("0.025", otherAsset.decimals);
  let fail = false;
  let receiptRequested = false;
  const confirmReceipt = Promise.withResolvers<void>();
  await page.route("**/api/evm/*/rpc", async route => {
    const { id: requestId, method, params } = route.request().postDataJSON();
    if (method === "eth_getTransactionReceipt" && params[0] === SOURCE_TX) {
      receiptRequested = true;
      await confirmReceipt.promise;
      status = 1;
      deadline = BigInt(Math.floor(Date.now() / 1000) + 3900);
      return route.fulfill({ json: { jsonrpc: "2.0", id: requestId, result: {
        transactionHash: SOURCE_TX, blockNumber: "0x1", status: "0x1", logs: [],
      } } });
    }
    if (method !== "eth_call" || params[0]?.to?.toLowerCase() !== compactAddress.toLowerCase()) return route.fallback();
    if (fail) return route.fulfill({ status: 502, json: { error: "RPC unavailable" } });
    const call = decodeFunctionData({ abi: recoveryAbi, data: params[0].data });
    const matching = call.args[1] === id;
    const amount = matching ? balance : call.args[1] === otherId ? otherBalance : 0n;
    if (call.functionName === "enableForcedWithdrawal") {
      return route.fulfill({ json: { jsonrpc: "2.0", id: requestId,
        result: encodeFunctionResult({ abi: recoveryAbi, functionName: "enableForcedWithdrawal", result: 3900n }),
      } });
    }
    const result = call.functionName === "balanceOf"
      ? encodeFunctionResult({ abi: recoveryAbi, functionName: "balanceOf", result: amount })
      : encodeFunctionResult({ abi: recoveryAbi, functionName: "getForcedWithdrawalStatus", result: matching ? [status, deadline] : [0, 0n] });
    return route.fulfill({ json: { jsonrpc: "2.0", id: requestId, result } });
  });
  await page.getByRole("link", { name: "Recovery", exact: true }).click();
  await expect(page).toHaveURL(/\/recovery$/);
  await expect(page.getByRole("heading", { name: "Recover Epoch deposits" })).toBeVisible();
  const recovery = page.getByRole("region", { name: "Recover Epoch deposits" });
  const deposits = recovery.getByRole("region", { name: "Locked deposits" });
  const detail = recovery.getByRole("region", { name: "Deposit details" });
  const usdc = deposits.getByRole("button", { name: /1\.2345 USDC.*Sepolia/ });
  const wbtc = deposits.getByRole("button", { name: /0\.025 WBTC.*Sepolia/ });
  const back = detail.getByRole("button", { name: "All locked deposits" });
  const refreshDetail = detail.getByRole("button", { name: "Refresh", exact: true });
  const withdraw = detail.getByRole("button", { name: "Withdraw to wallet" });
  await expect(deposits.getByRole("listitem")).toHaveCount(2);
  await expect(deposits.getByRole("button", { name: "Start withdrawal", exact: true })).toHaveCount(0);
  await wbtc.click();
  await expect(detail.getByRole("heading", { name: "0.025 WBTC", exact: true })).toBeVisible();
  await back.click();
  await expect(wbtc).toBeFocused();

  await usdc.click();
  const amount = detail.getByRole("heading", { name: "1.2345 USDC", exact: true });
  await expect(amount).toBeVisible();
  await expect(amount).toHaveAccessibleDescription("1.23456789 USDC");
  await expect(detail.getByRole("listitem")).toHaveCount(2);
  let rejectStart = true;
  respondToWallet(page, request => {
    if (request.method === "wallet_revokePermissions") return { result: null };
    expect(request.method).toBe("eth_sendTransaction");
    const [transaction] = request.params as [{ to: Address; data: Hex }];
    expect(transaction.to.toLowerCase()).toBe(compactAddress.toLowerCase());
    expect(decodeFunctionData({ abi: recoveryAbi, data: transaction.data })).toEqual({
      functionName: "enableForcedWithdrawal", args: [id],
    });
    if (rejectStart) return { error: { code: 4001, message: "User rejected the request." } };
    return { result: SOURCE_TX };
  });
  const start = detail.getByRole("button", { name: "Start withdrawal", exact: true });
  await start.click();
  await expect.poll(async () => (await walletRequests(page)).filter(request => request.method === "eth_sendTransaction").length).toBe(1);
  await expect(start).toBeEnabled();
  await expect(detail.getByRole("alert")).toHaveCount(0);

  rejectStart = false;
  await start.click();
  try {
    await expect.poll(() => receiptRequested).toBe(true);
    await expect(detail.getByRole("button", { name: "Waiting for confirmation…", exact: true })).toBeDisabled();
    await expect(detail.getByText("Waiting for confirmation…", { exact: true })).toHaveCount(1);
  } finally {
    confirmReceipt.resolve();
  }
  await expect(detail.getByRole("article").getByRole("status")).toHaveText("Withdrawal started");
  await expect(detail.getByText(/^\d+m \d+s$/)).toBeVisible();
  await expect(detail.getByText(/^Withdrawal started\.?$/)).toHaveCount(1);
  await expect(withdraw).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Cancel withdrawal" })).toBeEnabled();
  deadline = BigInt(Math.floor(Date.now() / 1000) - 1);
  await refreshDetail.click();
  await expect(withdraw).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("recovery-mobile.png"), fullPage: true, animations: "disabled" });
  balance = 1n;
  await refreshDetail.click();
  await expect(detail.getByRole("heading", { name: "<0.0001 USDC", exact: true })).toBeVisible();
  await expect(withdraw).toBeEnabled();
  fail = true;
  await refreshDetail.click();
  await expect(detail.getByRole("alert")).toContainText("Could not check deposits for USDC on Sepolia");
  await expect(withdraw).toHaveCount(0);
  fail = false;
  balance = 0n;
  status = 0;
  await refreshDetail.click();
  await expect(detail.getByText("No locked funds remain.")).toBeVisible();
  await back.click();
  await expect(wbtc).toBeVisible();
  otherBalance = 0n;
  const refreshList = deposits.getByRole("button", { name: "Refresh", exact: true });
  const empty = deposits.getByText("No locked deposits found.");
  await refreshList.click();
  await expect(empty).toBeVisible();

  const disconnect = recovery.getByRole("button", { name: "Disconnect", exact: true });
  const connect = recovery.getByRole("button", { name: "Connect wallet", exact: true });
  await expect(disconnect).toBeEnabled();
  await disconnect.click();
  await expect(connect).toBeEnabled();
  await expect(deposits).toHaveCount(0);

  await connect.click();
  await page.getByText("Browser test wallet", { exact: true }).click();
  await expect(empty).toBeVisible();

  otherBalance = parseUnits("0.025", otherAsset.decimals);
  await refreshList.click();
  await wbtc.click();
  await expect(detail.getByRole("heading", { name: "0.025 WBTC", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Bridge network" }).click();
  await page.getByRole("option", { name: "Mainnet", exact: true }).click();
  await expect(empty).toBeVisible();
  await expect(page).toHaveURL(/\/recovery$/);
});
