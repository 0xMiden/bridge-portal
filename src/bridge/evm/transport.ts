import { http } from "viem";
import type { EvmNetwork } from "../core/assets";

/** Public reads use our origin; signing uses the connected wallet's transport. */
export function evmReadTransport(network: EvmNetwork) {
  return http(`/api/evm/${network}/rpc`, { timeout: 30_000, retryCount: 0 });
}
