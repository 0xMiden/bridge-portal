import { test, expect } from "../../fixtures/bridge";
import { expectAgglayerDeposit } from "../../fixtures/deposit";
import { respondToWallet, walletRequests } from "../../fixtures/wallets";

// Reject the actual deposit signature, after production validation and encoding.
test("rejecting a deposit signature preserves the form without creating a receipt", async ({ bridge, page }) => {
  respondToWallet(page, request => {
    expectAgglayerDeposit(request);
    return { error: { code: 4001, message: "User rejected the request." } };
  });
  await bridge.setRoute("AggLayer");
  await bridge.fillAmount("0.01");
  await bridge.submit();
  await expect(page.locator(".form-error")).toContainText(/cancelled/i);
  expect((await walletRequests(page)).filter(request => request.method === "eth_sendTransaction")).toHaveLength(1);
  await expect(page.locator(".swap-card")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("0.01");
  expect(await bridge.readActivities()).toEqual([]);
});
