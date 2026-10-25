import type { Page } from "@playwright/test";

// Public extension transports only. No application imports or build flags.
export const EVM_ADDRESS = "0xE2E0000000000000000000000000000000000001";
export const MIDEN_ADDRESS = "mtst1aqk5t00kapdcnq2yyf77dz6xcysswce0_qr7qqq9wr6w";
const MAINNET_MIDEN_ADDRESS = "mm1aqu8zjdwvcgkeug5a67kpwmnsyv2qgp7";
export const SOURCE_TX = `0x${"ab".repeat(32)}`;
export type WalletRequest = { wallet: "evm" | "miden"; method: string; params: unknown[]; chainId?: string };
type Response = { result: unknown } | { error: { message: string; code?: number } };
type Handler = (request: WalletRequest) => Response | Promise<Response>;
const handlers = new WeakMap<Page, Handler>();

declare global {
  interface Window {
    testWallets: {
      requests: WalletRequest[];
      rejectSwitch: boolean;
      changeMidenAccount: (address: string) => void;
    };
    respondToWallet: (request: WalletRequest) => Promise<Response>;
  }
}

/** Tests must inspect a write request before explicitly accepting or rejecting it. */
export function respondToWallet(page: Page, handler: Handler) {
  handlers.set(page, handler);
}

export async function walletRequests(page: Page) {
  return page.evaluate(() => window.testWallets.requests);
}

export async function installWallets(page: Page) {
  await page.exposeFunction("respondToWallet", (request: WalletRequest) => {
    const handler = handlers.get(page);
    if (!handler) throw new Error(`Unexpected ${request.wallet} wallet request: ${request.method}`);
    return handler(request);
  });
  await page.addInitScript(({ evm, miden, mainnet }) => {
    const requests: WalletRequest[] = [];
    const call = async (wallet: WalletRequest["wallet"], method: string, params: unknown[]) => {
      const request = { wallet, method, params, ...(wallet === "evm" ? { chainId } : {}) };
      requests.push(request);
      const response = await window.respondToWallet(request);
      if ("error" in response) throw Object.assign(new Error(response.error.message), { code: response.error.code });
      return response.result;
    };
    const midenListeners = new Set<() => void>();
    const extension = {
      address: undefined as string | undefined,
      publicKey: null,
      connect: async (_permission: string, network: string) => {
        extension.address = network === "mainnet" ? mainnet : miden;
      },
      disconnect: async () => { extension.address = undefined; },
      on: (event: string, callback: () => void) => { if (event === "accountChange") midenListeners.add(callback); },
      off: (event: string, callback: () => void) => { if (event === "accountChange") midenListeners.delete(callback); },
      requestAssets: async () => ({ assets: extension.address !== miden ? [] : [
        { faucetId: "0x7c6d1dc7fb7045913d524bbef017f5", amount: "10000000" },
        { faucetId: "0x5b043dcb48d5721106f7a1ceb2b804", amount: "1000000" },
      ] }),
      requestConsumableNotes: async () => ({ consumableNotes: [] }),
      requestSend: (transaction: unknown) => call("miden", "requestSend", [transaction]),
      requestTransaction: (transaction: unknown) => call("miden", "requestTransaction", [transaction]),
      waitForTransaction: (id: string) => call("miden", "waitForTransaction", [id]),
    };
    window.testWallets = { requests, rejectSwitch: false, changeMidenAccount: address => {
      extension.address = address;
      midenListeners.forEach(listener => listener());
    } };
    let chainId = sessionStorage.getItem("test.wallet.chain") ?? "0xaa36a7";
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    const provider = {
      on: (event: string, listener: (value: unknown) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
      },
      removeListener: (event: string, listener: (value: unknown) => void) => listeners.get(event)?.delete(listener),
      request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
        switch (method) {
          case "eth_requestAccounts": case "eth_accounts": return [evm];
          case "eth_chainId": return chainId;
          case "wallet_getCapabilities": return {};
          case "wallet_switchEthereumChain": {
            requests.push({ wallet: "evm", method, params });
            if (window.testWallets.rejectSwitch) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
            chainId = (params[0] as { chainId: string }).chainId;
            sessionStorage.setItem("test.wallet.chain", chainId);
            listeners.get("chainChanged")?.forEach(listener => listener(chainId));
            return null;
          }
          case "wallet_addEthereumChain": return null;
          default: return call("evm", method, params);
        }
      },
    };
    Object.assign(window, { midenWallet: extension, ethereum: provider });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: {
      info: { uuid: "cbd69d4b-16f4-4df0-94fb-c8b768186ca0", name: "Browser test wallet", rdns: "test.bridge.wallet",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" },
      provider,
    } }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, { evm: EVM_ADDRESS, miden: MIDEN_ADDRESS, mainnet: MAINNET_MIDEN_ADDRESS });
}
