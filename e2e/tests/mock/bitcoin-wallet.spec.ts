import { test, expect } from "@playwright/test";
import { installWallets, respondToWallet, walletRequests } from "../../fixtures/wallets";
import { installBitcoinWallet, connectBitcoinWallet, selectBitcoinRoute } from "../../fixtures/bitcoin-wallet";
import { stubNetwork } from "../../fixtures/mock-network";
import { BridgePage } from "../../pages/bridge-page";

test("Bitcoin and EVM connections keep separate accounts and disconnect independently", async ({ page }) => {
  await installWallets(page);
  respondToWallet(page, request => {
    expect(request).toMatchObject({ wallet: "evm", method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    return { result: null };
  });
  await stubNetwork(page);
  await installBitcoinWallet(page, "1BoatSLRHtKNngkdXEeobR76b53LETtpyT");
  await selectBitcoinRoute(page, "receive");
  await page.goto("/");
  await connectBitcoinWallet(page);
  const bridge = new BridgePage(page);
  await bridge.setChain("Ethereum");
  const evm = page.locator('[data-wallet="evm"] .wallet-pill');
  // The injected EVM transport can restore an already-authorized account.
  if ((await evm.getAttribute("data-connected")) !== "true") {
    await evm.click();
    await page.getByText("Browser test wallet", { exact: true }).click();
  }
  await expect(evm).toHaveAttribute("data-connected", "true");
  await expect(evm).toContainText("0xE2E0");

  await bridge.setChain("Bitcoin");
  await page.getByRole("button", { name: "Bitcoin wallet menu" }).click();
  await page.getByRole("menuitem", { name: "Forget in app" }).click();
  await expect(page.getByRole("button", { name: "Connect Bitcoin wallet", exact: true })).toBeVisible();
  await bridge.setChain("Ethereum");
  await expect(evm).toHaveAttribute("data-connected", "true");
  await expect(evm).toContainText("0xE2E0");

  await bridge.setChain("Bitcoin");
  await connectBitcoinWallet(page);
  await bridge.setChain("Ethereum");
  await evm.click();
  await page.getByRole("menuitem", { name: "Forget in app" }).click();
  await expect(evm).toHaveAttribute("data-connected", "false");
  await bridge.setChain("Bitcoin");
  await expect(page.getByRole("button", { name: "Bitcoin wallet menu" })).toContainText("1BoatS");
  expect(await walletRequests(page)).toEqual([
    { wallet: "evm", method: "wallet_revokePermissions", params: [{ eth_accounts: {} }], chainId: "0xaa36a7" },
  ]);
});
