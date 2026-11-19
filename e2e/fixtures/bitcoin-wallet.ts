import { expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    testBitcoinWallet: { changeAccounts: (addresses: string[]) => void; changeChain: (chain: string) => void };
  }
}

/** UniSat's public extension API; AppKit discovery and its actual adapter run unchanged. */
export async function installBitcoinWallet(page: Page, address: string) {
  await page.addInitScript(initialAddress => {
    let accounts = [initialAddress];
    let chain = "BITCOIN_MAINNET";
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    const provider = {
      requestAccounts: async () => accounts,
      getAccounts: async () => accounts,
      getPublicKey: async () => `02${"11".repeat(32)}`,
      getChain: async () => ({ enum: chain, name: chain, network: "livenet" }),
      switchChain: async () => {},
      on: (event: string, listener: (value: unknown) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
      },
      removeListener: (event: string, listener: (value: unknown) => void) => listeners.get(event)?.delete(listener),
      sendBitcoin: async (recipient: string, satoshis: number) => {
        const request = { wallet: "bitcoin" as const, method: "sendBitcoin", params: [recipient, satoshis] };
        window.testWallets.requests.push(request);
        const response = await window.respondToWallet(request);
        if ("error" in response) throw Object.assign(new Error(response.error.message), { code: response.error.code });
        return response.result;
      },
    };
    Object.assign(window, { unisat: provider });
    window.testBitcoinWallet = { changeChain: next => { chain = next; }, changeAccounts: addresses => {
      accounts = addresses;
      listeners.get("accountsChanged")?.forEach(listener => listener(addresses));
    } };
  }, address);
  await page.route("https://mempool.space/api/address/*/utxo", route => route.fulfill({ json: [
    { txid: "12".repeat(32), vout: 0, value: 1000000, status: { confirmed: true } },
  ] }));
}

export async function connectBitcoinWallet(page: Page) {
  await page.locator('[data-wallet="bitcoin"]').getByRole("button", { name: "Connect Bitcoin wallet", exact: true }).click();
  await page.getByText("Unisat Wallet", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Bitcoin wallet menu" })).toHaveAttribute("data-connected", "true");
}

export async function selectBitcoinRoute(page: Page, mode: "send" | "receive") {
  await page.addInitScript(direction => {
    sessionStorage.setItem("miden.bridge.ui.environment", "mainnet");
    localStorage.setItem("miden.bridge.ui.route.mainnet", "near");
    localStorage.setItem("miden.bridge.ui.route.mainnet.id", direction === "receive"
      ? "mainnet:near-bitcoin-btc-to-miden-wbtc" : "mainnet:near-miden-wbtc-to-bitcoin-btc");
    localStorage.setItem("miden.bridge.ui.mode.mainnet", direction);
  }, mode);
}
