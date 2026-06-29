import { AGGLAYER_BALI } from "./agglayer";

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
  if (chainId === AGGLAYER_BALI.sepoliaChainHex) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: AGGLAYER_BALI.sepoliaChainHex }],
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
          chainId: AGGLAYER_BALI.sepoliaChainHex,
          chainName: "Ethereum Sepolia",
          nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: [AGGLAYER_BALI.sepoliaRpcUrl],
          blockExplorerUrls: [AGGLAYER_BALI.sepoliaExplorer],
        },
      ],
    });
  }
}
