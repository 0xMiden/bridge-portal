import { expect, test } from "../../fixtures/bridge";
import { walletRequests } from "../../fixtures/wallets";
import { stubNetwork } from "../../fixtures/mock-network";

// Exercise SDK events, React lifetime, and the hook through the extension transport.
test("Miden restores and syncs without a mounted wallet button", async ({ page }) => {
  await stubNetwork(page);
  await page.addInitScript(() => {
    sessionStorage.setItem("miden.bridge.ui.environment", "mainnet");
    localStorage.setItem("miden-bridge-wallet-connected.mainnet", "1");
    const listeners = new Set<() => void>();
    const extension = {
      address: "mm1aqu8zjdwvcgkeug5a67kpwmnsyv2qgp7",
      publicKey: null,
      connects: 0,
      disconnects: 0,
      assetReads: 0,
      noteReads: 0,
      finishNotes: () => {},
      connect: async () => { extension.connects++; },
      disconnect: async () => { extension.disconnects++; },
      on: (event: string, callback: () => void) => { if (event === "accountChange") listeners.add(callback); },
      off: (event: string, callback: () => void) => { if (event === "accountChange") listeners.delete(callback); },
      requestAssets: async () => { extension.assetReads++; return { assets: [] }; },
      requestConsumableNotes: () => {
        extension.noteReads++;
        return new Promise(resolve => { extension.finishNotes = () => resolve({ consumableNotes: [] }); });
      },
    };
    Object.assign(window, { midenWallet: extension });
  });
  const counts = () => page.evaluate(() => {
    const wallet = (window as unknown as { midenWallet: { connects: number; disconnects: number; assetReads: number; noteReads: number } }).midenWallet;
    return { connects: wallet.connects, disconnects: wallet.disconnects, assetReads: wallet.assetReads, noteReads: wallet.noteReads };
  });

  await page.goto("/activity/session-test");
  await expect(page.getByRole("heading", { name: "Activity not found" })).toBeVisible();
  await expect.poll(counts).toEqual({ connects: 1, disconnects: 0, assetReads: 1, noteReads: 0 });
  await page.getByRole("link", { name: "New transfer", exact: true }).click();
  await page.getByRole("button", { name: "Bread wallet menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sync wallet state" }).click();
  await expect(page.getByText("Note sync: Syncing notes.", { exact: false })).toBeVisible();
  await expect.poll(counts).toEqual({ connects: 1, disconnects: 0, assetReads: 2, noteReads: 1 });

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Activity not found" })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { midenWallet: { finishNotes: () => void } }).midenWallet.finishNotes();
  });
  await page.getByRole("link", { name: "New transfer", exact: true }).click();
  await page.getByRole("button", { name: "Bread wallet menu", exact: true }).click();
  await expect(page.getByText("Note sync: No consumable notes.", { exact: false })).toBeVisible();
  expect(await counts()).toEqual({ connects: 1, disconnects: 0, assetReads: 2, noteReads: 1 });
});

test("resetting a timed-out adapter preserves the bridge form", async ({ page }) => {
  await stubNetwork(page);
  await page.clock.install();
  await page.addInitScript(() => {
    sessionStorage.setItem("miden.bridge.ui.environment", "mainnet");
    Object.assign(window, { midenWallet: {
      address: null, publicKey: null,
      connect: () => new Promise(() => {}),
      disconnect: async () => {},
      on: () => {}, off: () => {},
    } });
  });
  await page.goto("/");
  const amount = page.getByRole("textbox", { name: "Amount", exact: true });
  await amount.fill("0.02");
  await page.getByRole("button", { name: "Connect Bread wallet", exact: true }).click();
  await page.getByRole("menuitem", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connecting Bread wallet", exact: true })).toBeVisible();
  await page.clock.fastForward(45_001);
  await expect(page.getByRole("alert").filter({ hasText: "45 seconds" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Bread wallet", exact: true })).toBeVisible();
  await expect(amount).toHaveValue("0.02");
  expect(await page.evaluate(() => localStorage.getItem("miden-bridge-wallet-connected.mainnet"))).toBeNull();
});

test("an extension account change invalidates review and replaces the recipient and balances", async ({ bridge, page }) => {
  const next = "mtst1aqu8zjdwvcgkeug5a67kpwmnsymvmkg0_qr7qqq9wr6w";
  await bridge.setRoute("AggLayer");
  await bridge.fillAmount("0.01");
  await bridge.openPreflight();
  await page.evaluate(address => window.testWallets.changeMidenAccount(address), next);
  await expect(bridge.preflight().getByRole("alert")).toContainText("Your connected wallet changed");
  await expect(page.getByRole("button", { name: "Confirm in wallet", exact: true })).toBeDisabled();
  expect(await walletRequests(page)).toEqual([]);
  await bridge.cancelPreflight();
  await expect(page.locator('.swap-box[data-side="destination"]')).toContainText("Available 0 ETH");
  await bridge.openPreflight();
  await expect(page.locator("#preflight-destination-value")).toHaveAttribute("title", next);
  await expect(page.getByRole("button", { name: "Confirm in wallet", exact: true })).toBeEnabled();
});
