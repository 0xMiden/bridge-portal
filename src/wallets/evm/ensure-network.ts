import type { Chain } from "viem";
import type { EvmProvider } from "./evm-wallet";

export async function ensureEvmNetwork(provider: EvmProvider, chain: Chain) {
  if (Number(await provider.request({ method: "eth_chainId" })) === chain.id) return;
  const chainId = `0x${chain.id.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || Number(error.code) !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId, chainName: chain.name,
      nativeCurrency: chain.nativeCurrency, rpcUrls: chain.rpcUrls.default.http,
      blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : [],
    }] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  }
  if (Number(await provider.request({ method: "eth_chainId" })) !== chain.id)
    throw new Error(`Switch your wallet to ${chain.name}.`);
}
