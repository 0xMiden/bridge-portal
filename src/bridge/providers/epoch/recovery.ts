import { createPublicClient, getAddress, parseAbi, zeroAddress, type Address } from "viem";
import type { BridgeEnvironment } from "../../../config/environment";
import { tokenRegistry } from "../../../config/token-registry";
import { evmNetworks } from "../../../config/evm-networks";
import { assetKey, type EvmAsset } from "../../core/assets";
import { evmReadTransport } from "../../evm/transport";

export const COMPACT_ADDRESS = getAddress("0x00000000000000171ede64904551eedf3c6c9788");
export const recoveryAbi = parseAbi([
  "function balanceOf(address owner, uint256 id) view returns (uint256)",
  "function getForcedWithdrawalStatus(address account, uint256 id) view returns (uint8 status, uint256 withdrawableAt)",
  "function enableForcedWithdrawal(uint256 id) returns (uint256 withdrawableAt)",
  "function disableForcedWithdrawal(uint256 id) returns (bool)",
  "function forcedWithdrawal(uint256 id, address recipient, uint256 amount) returns (bool)",
]);

// These deployed Epoch locks remain recoverable when the allocator is offline.
const allocators = {
  mainnet: "0xC7a2E29b7ef4543a3e7c50057d83beDfCdE2fb0C",
  testnet: "0xa46827635A7d329608085401a3b2Bf14a8a2bDF9",
};

export function recoveryLockId(asset: EvmAsset, environment: BridgeEnvironment) {
  const allocatorId = BigInt(allocators[environment]) & ((1n << 88n) - 1n);
  // Both allocators have compact flag 0. Scope is 0; reset period is 4.
  const lockTag = (4n << 92n) | allocatorId;
  return (lockTag << 160n) | BigInt(asset.kind === "native" ? zeroAddress : asset.address);
}

export function recoveryAssets(environment: BridgeEnvironment): EvmAsset[] {
  const assets = tokenRegistry[environment].filter(pair => pair.provider === "epoch").map(pair => pair.evm);
  return [...new Map(assets.map(asset => [assetKey(asset), asset])).values()];
}

export function recoveryClient(asset: EvmAsset) {
  return createPublicClient({ chain: evmNetworks[asset.network], transport: evmReadTransport(asset.network) });
}

export type LockedDeposit = {
  asset: EvmAsset;
  id: bigint;
  balance: bigint;
  status: number;
  withdrawableAt: bigint;
};

export async function readLockedDeposit(asset: EvmAsset, environment: BridgeEnvironment, sponsor: Address): Promise<LockedDeposit> {
  const client = recoveryClient(asset);
  const id = recoveryLockId(asset, environment);
  const [balance, [status, withdrawableAt]] = await Promise.all([
    client.readContract({ address: COMPACT_ADDRESS, abi: recoveryAbi, functionName: "balanceOf", args: [sponsor, id] }),
    client.readContract({ address: COMPACT_ADDRESS, abi: recoveryAbi, functionName: "getForcedWithdrawalStatus", args: [sponsor, id] }),
  ]);
  if (status > 2) throw new Error("The withdrawal status is not supported.");
  return { asset, id, balance, status, withdrawableAt };
}

export type RecoveryAction = "start" | "cancel" | "withdraw";

export function withdrawalReady(deposit: Pick<LockedDeposit, "status" | "withdrawableAt">, now: number) {
  return deposit.status !== 0 && deposit.withdrawableAt <= BigInt(now);
}
