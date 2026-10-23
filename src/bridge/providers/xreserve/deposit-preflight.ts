import type { BridgeConfig } from "../../../config/bridge-config";
import { createPublicClient, parseAbi, type PublicClient } from "viem";
import { evmReadTransport } from "../../evm/transport";
import { normalizeMidenAccountHex } from "../agglayer/agglayer";
import { cctpConfig, type CctpNetwork, arcConfig, xReserveAbi } from "./config";
import { arcRecipient } from "./deposit-terms";

const pausedAbi = parseAbi(["function paused() view returns (bool)"]);

export async function validateMidenRecipient(recipient: string) {
  const { AccountId } = await import("@miden-sdk/miden-sdk");
  const id = AccountId.fromHex(`0x${normalizeMidenAccountHex(recipient)}`);
  id.free();
}

export async function assertArcRouteAvailable(client: Pick<PublicClient, "readContract">, arc: ReturnType<typeof arcConfig>) {
  const [registered, remoteToken] = await Promise.all([
    client.readContract({ address: arc.xReserve, abi: xReserveAbi, functionName: "isRemoteDomainRegistered", args: [arc.midenDomain] }),
    client.readContract({ address: arc.xReserve, abi: xReserveAbi, functionName: "getRemoteToken", args: [arc.midenDomain, arc.usdc] }),
  ]);
  if (!registered) {
    throw new Error(`Miden deposits are not registered on this ${arc.chain.name} contract yet.`);
  }
  if (remoteToken.toLowerCase() !== arcRecipient(arc.faucetId)) {
    throw new Error("Circle has not configured the current Miden USDCx faucet. Please try again later.");
  }
}

export async function assertCctpRouteAvailable(network: CctpNetwork, recovery?: BridgeConfig) {
  const arc = arcConfig(recovery);
  const cctp = cctpConfig(recovery, network);
  const client = createPublicClient({ chain: arc.chain, transport: evmReadTransport(arc.network) });
  const [, executorPaused, handlerPaused] = await Promise.all([
    assertArcRouteAvailable(client, arc),
    client.readContract({ address: cctp.executor, abi: pausedAbi, functionName: "paused" }),
    client.readContract({ address: cctp.handler, abi: pausedAbi, functionName: "paused" }),
  ]);
  if (executorPaused || handlerPaused) {
    throw new Error("Circle's Miden deposit route is unavailable. Please try again later.");
  }
}
