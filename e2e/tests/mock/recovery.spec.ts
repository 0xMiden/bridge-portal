import { test, expect } from "../../fixtures/bridge";
import { decodeFunctionData, encodeFunctionResult } from "viem";
import { recoveryAbi, recoveryAssets, recoveryLockId } from "../../../src/bridge/providers/epoch/recovery";

test("Recovery shows on-chain locks without transfer history and refreshes external withdrawals", async ({ bridge, page }, info) => {
  await bridge.waitForReady();
  const asset = recoveryAssets("testnet").find(token => token.symbol === "USDC");
  if (!asset) throw new Error("Missing Fast USDC fixture");
  const id = recoveryLockId(asset, "testnet");
  let status = 0;
  let deadline = 0n;
  let balance = 1000000n;
  let fail = false;
  await page.route("**/api/evm/*/rpc", async route => {
    const request = route.request().postDataJSON();
    if (fail) return route.fulfill({ status: 502, json: { error: "RPC unavailable" } });
    const call = decodeFunctionData({ abi: recoveryAbi, data: request.params[0].data });
    const matching = call.args[1] === id;
    const result = call.functionName === "balanceOf"
      ? encodeFunctionResult({ abi: recoveryAbi, functionName: "balanceOf", result: matching ? balance : 0n })
      : encodeFunctionResult({ abi: recoveryAbi, functionName: "getForcedWithdrawalStatus", result: matching ? [status, deadline] : [0, 0n] });
    return route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result } });
  });
  await page.getByRole("link", { name: "Recovery", exact: true }).click();
  await expect(page).toHaveURL(/\/recovery$/);
  await expect(page.getByRole("heading", { name: "Recover Fast deposits" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /1 USDC locked on/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start withdrawal", exact: true })).toBeEnabled();
  status = 1;
  deadline = BigInt(Math.floor(Date.now() / 1000) + 3900);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(/Withdrawal available in/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Withdraw to wallet" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Disable withdrawal to bridge again" })).toBeEnabled();
  deadline = BigInt(Math.floor(Date.now() / 1000) - 1);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Withdraw to wallet" })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("recovery-mobile.png"), fullPage: true });
  fail = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("These balances are not known");
  await expect(page.getByText(/No locked Fast deposits found/)).toHaveCount(0);
  fail = false;
  balance = 0n;
  status = 0;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(/No locked Fast deposits found/)).toBeVisible();
});
