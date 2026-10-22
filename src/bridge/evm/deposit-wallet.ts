import { createPublicClient, createWalletClient, custom, type Address } from "viem";
import { evmNetworks } from "../../config/evm-networks";
import { ensureEvmNetwork } from "../../wallets/evm/ensure-network";
import type { EvmProvider } from "../../wallets/evm/evm-wallet";
import type { EvmNetwork } from "../core/assets";
import { evmReadTransport } from "./transport";

async function assertWalletState(provider: EvmProvider, account: Address, chainId: number) {
  const accounts = await provider.request<string[]>({ method: "eth_accounts" });
  const selectedChain = Number(await provider.request({ method: "eth_chainId" }));
  if (accounts[0]?.toLowerCase() !== account.toLowerCase() || selectedChain !== chainId) {
    throw new Error("Your wallet account or network changed. Review the transfer again.");
  }
}

/** Public RPC reads and wallet signing always use the same selected source chain. */
export async function prepareDepositWallet(network: EvmNetwork, provider: EvmProvider, account: Address) {
  const chain = evmNetworks[network];
  await ensureEvmNetwork(provider, chain);
  return {
    client: createPublicClient({ chain, transport: evmReadTransport(network) }),
    wallet: createWalletClient({ chain, transport: custom(provider) }),
    assertWallet: () => assertWalletState(provider, account, chain.id),
  };
}

export type DepositWallet = Awaited<ReturnType<typeof prepareDepositWallet>>;
