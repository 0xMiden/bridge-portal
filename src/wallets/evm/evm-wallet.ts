import { SEPOLIA_NETWORK } from "../../config/sepolia";

export type EvmProvider = {
  request<T = unknown>(args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }): Promise<T>;
  on?(
    event: "accountsChanged" | "chainChanged" | "disconnect" | "connect",
    listener: (...args: unknown[]) => void,
  ): void;
  removeListener?(
    event: "accountsChanged" | "chainChanged" | "disconnect" | "connect",
    listener: (...args: unknown[]) => void,
  ): void;
  disconnect?(): Promise<void>;
};

export async function ensureSepolia(provider: EvmProvider) {
  const chainId = await provider.request<string>({ method: "eth_chainId" });
  if (chainId === SEPOLIA_NETWORK.chainHex) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_NETWORK.chainHex }],
    });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? Number(error.code)
        : 0;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: SEPOLIA_NETWORK.chainHex,
          chainName: "Ethereum Sepolia",
          nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: [SEPOLIA_NETWORK.rpcUrl],
          blockExplorerUrls: [SEPOLIA_NETWORK.explorerUrl],
        },
      ],
    });
  }
}
