import type { FeeValuesEIP1559 } from "viem";

// Only consume common EVM fields; Base/Arbitrum have additional block formats.
export type FeeSuggestionClient = {
  getBlock(args: { blockTag: "latest" }): Promise<{ baseFeePerGas?: bigint | null }>;
  estimateMaxPriorityFeePerGas(): Promise<bigint>;
};

/** Fresh Bread-style pricing. RPC transport handles provider failover; viem
 * falls back to gasPrice - baseFee when the priority-fee method is unavailable.
 * Never invent a zero tip on failure: omit both fields and let the wallet price.
 */
export async function suggestEvmFees(client: FeeSuggestionClient): Promise<FeeValuesEIP1559 | undefined> {
  try {
    const [block, tip] = await Promise.all([
      client.getBlock({ blockTag: "latest" }),
      client.estimateMaxPriorityFeePerGas(),
    ]);
    const base = block.baseFeePerGas;
    if (typeof base !== "bigint" || base < 0n || typeof tip !== "bigint" || tip < 0n) return undefined;
    return { maxFeePerGas: base * 2n + tip, maxPriorityFeePerGas: tip };
  } catch {
    return undefined;
  }
}
