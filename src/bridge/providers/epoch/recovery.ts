import type { HealthCheckResponse } from "@epoch-protocol/epoch-intents-sdk";
import { createLockTag, getAllocatorId, getTokenId } from "@epoch-protocol/epoch-intents-sdk/dist/helpers/chains";
import { createPublicClient, getAddress, isAddress, maxUint160, maxUint256, parseAbi, zeroAddress, type Address } from "viem";
import type { BridgeConfig } from "../../../config/bridge-config";
import type { BridgeEnvironment } from "../../../config/environment";
import { tokenRegistry } from "../../../config/token-registry";
import { evmNetworks } from "../../../config/evm-networks";
import { assetKey, type EvmAsset } from "../../core/assets";
import type { Activity } from "../../core/models";
import { evmReadTransport } from "../../evm/transport";

const legacyCompact = getAddress("0x00000000000000171ede64904551eedf3c6c9788");
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
} as const;

export type RecoveryLock = { asset: EvmAsset; compactAddress: Address; id: bigint };

function lockToken(asset: EvmAsset) {
  return BigInt(asset.kind === "native" ? zeroAddress : asset.address);
}

function compactLock(asset: EvmAsset, compactAddress: Address, allocator: Address, resetPeriod: number, scope: number): RecoveryLock {
  const tag = createLockTag(BigInt(resetPeriod), BigInt(scope), getAllocatorId(allocator));
  return { asset, compactAddress, id: getTokenId(tag, lockToken(asset)) };
}

export function legacyRecoveryLock(asset: EvmAsset, environment: BridgeEnvironment) {
  return compactLock(asset, legacyCompact, allocators[environment], 4, 0);
}

export async function readEpochHealth(recovery: BridgeConfig) {
  const { getEpochReadOnlySdk } = await import("./sdk");
  return (await getEpochReadOnlySdk(zeroAddress, recovery)).getHealthCheck();
}

export function configuredRecoveryLock(asset: EvmAsset, health: HealthCheckResponse) {
  const chainId = evmNetworks[asset.network].id;
  const compact = health.compactAddresses?.[chainId];
  if (!compact || !isAddress(compact, { strict: false }) || compact === zeroAddress)
    throw new Error("Epoch has no Compact address configured for this network.");
  const allocator = health.allocatorAddresses?.[chainId];
  const { compactLockResetPeriod: period, compactLockScope: scope } = health;
  if (!allocator || !isAddress(allocator, { strict: false }) || allocator === zeroAddress ||
      !Number.isInteger(period) || period < 0 || period > 7 || (scope !== 0 && scope !== 1))
    throw new Error("Epoch cannot verify the deposit lock for this network.");
  return compactLock(asset, getAddress(compact), allocator, period, scope);
}

export function recoveryAssets(environment: BridgeEnvironment): EvmAsset[] {
  const assets = tokenRegistry[environment].filter(pair => pair.provider === "epoch").map(pair => pair.evm);
  return [...new Map(assets.map(asset => [assetKey(asset), asset])).values()];
}

export function recoveryLockKey(lock: RecoveryLock) {
  return `${assetKey(lock.asset)}:${lock.compactAddress}:${lock.id}`;
}

function recordedLock(activity: Activity, environment: BridgeEnvironment, sponsor: Address): RecoveryLock | undefined {
  const asset = activity.routeSnapshot?.source;
  if (activity.provider !== "epoch" || activity.mode !== "receive" || activity.environment !== environment ||
      typeof activity.epochSponsor !== "string" || activity.epochSponsor.toLowerCase() !== sponsor.toLowerCase() ||
      !asset || asset.kind === "miden") return;
  const compact = activity.epochCompactAddress;
  const depositId = activity.epochDepositId;
  if (typeof compact !== "string" || !isAddress(compact, { strict: false }) || compact === zeroAddress ||
      typeof depositId !== "string" || !/^\d{1,78}$/.test(depositId)) return;
  const id = BigInt(depositId);
  if (id > maxUint256 || (id & maxUint160) !== lockToken(asset)) return;
  return { asset, compactAddress: getAddress(compact), id };
}

export function recoveryLocks(environment: BridgeEnvironment, sponsor: Address, activities: readonly Activity[], health?: HealthCheckResponse) {
  const assets = recoveryAssets(environment);
  const known = assets.map(asset => legacyRecoveryLock(asset, environment));
  const unconfiguredAssets: EvmAsset[] = [];
  if (health) for (const asset of assets) {
    try { known.push(configuredRecoveryLock(asset, health)); }
    catch { unconfiguredAssets.push(asset); }
  }
  for (const activity of activities) {
    const lock = recordedLock(activity, environment, sponsor);
    if (lock) known.push(lock);
  }
  const locks = [...new Map(known.map(lock => [recoveryLockKey(lock), lock])).values()];
  return { locks, unconfiguredAssets };
}

export function recoveryClient(asset: EvmAsset) {
  return createPublicClient({ chain: evmNetworks[asset.network], transport: evmReadTransport(asset.network) });
}

export type LockedDeposit = RecoveryLock & {
  balance: bigint;
  status: number;
  withdrawableAt: bigint;
  blockNumber?: bigint;
};

export async function readLockedDeposit(lock: RecoveryLock, sponsor: Address, minimumBlock?: bigint): Promise<LockedDeposit> {
  const { asset, compactAddress: address, id } = lock;
  const client = recoveryClient(asset);
  const blockNumber = minimumBlock === undefined ? undefined : await client.getBlockNumber().then(latest =>
    latest < minimumBlock ? minimumBlock : latest,
  );
  const [balance, [status, withdrawableAt]] = await Promise.all([
    client.readContract({ address, abi: recoveryAbi, functionName: "balanceOf", args: [sponsor, id], blockNumber }),
    client.readContract({ address, abi: recoveryAbi, functionName: "getForcedWithdrawalStatus", args: [sponsor, id], blockNumber }),
  ]);
  if (status > 2) throw new Error("The withdrawal status is not supported.");
  return { asset, compactAddress: address, id, balance, status, withdrawableAt, blockNumber };
}

export type RecoveryAction = "start" | "cancel" | "withdraw";

export function withdrawalReady(deposit: Pick<LockedDeposit, "status" | "withdrawableAt">, now: number) {
  return deposit.status !== 0 && deposit.withdrawableAt <= BigInt(now);
}
