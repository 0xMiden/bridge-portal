import "server-only";
import { createPublicClient, http, keccak256, pad, parseAbi } from "viem";
import type { EvmHelperIdentity } from "../../../config/cctp-evm-helper";
import type { EvmHelperServer } from "../../../config/cctp-evm-helper.server";
import { requiredManualFee } from "./helper-hook";
import { boundedText } from "../../solana/rpc";
import { z } from "zod";
const abi = parseAbi([
  "function paused() view returns(bool)", "function isBlacklisted(address) view returns(bool)", "function balanceOf(address) view returns(uint256)",
  "function localDomain() view returns(uint32)", "function version() view returns(uint32)", "function maxMessageBodySize() view returns(uint256)",
  "function localMessageTransmitter() view returns(address)", "function localMinter() view returns(address)", "function messageBodyVersion() view returns(uint32)",
  "function remoteTokenMessengers(uint32) view returns(bytes32)", "function burnLimitsPerMessage(address) view returns(uint256)",
  "function localTokenMessenger() view returns(address)", "function getMinFeeAmount(uint256) view returns(uint256)", "function isDenylisted(address) view returns(bool)",
]);
export function evmSourceClient(server: EvmHelperServer) {
  return createPublicClient({ transport: http(server.sourceRpc, { retryCount: 0, timeout: 10_000 }) });
}
export async function assertEvmSourcePolicy(d: EvmHelperIdentity, server: EvmHelperServer, owner: `0x${string}`, amount: bigint) {
  const client = evmSourceClient(server), s = d.source;
  if (await client.getChainId() !== s.chainId) throw new Error("Source chain mismatch.");
  await Promise.all([s.usdc, s.tokenMessenger, s.messageTransmitter, s.tokenMinter].map(async contract => {
    const code = await client.getCode({ address: contract.address });
    if (!code || keccak256(code) !== contract.runtimeHash) throw new Error("Source runtime mismatch.");
  }));
  await assertSourceImplementation(d, client);
  if (await client.getBalance({ address: owner }) === 0n) throw new Error("Source native gas balance is zero.");
  const senderCode = await client.getCode({ address: owner });
  if (senderCode && senderCode !== "0x") throw new Error("This route requires a qualified direct EOA wallet.");
  if (await client.readContract({ address: s.tokenMessenger.address, abi, functionName: "isDenylisted", args: [owner] }))
    throw new Error("Circle source sender is denylisted.");
  const checks = await Promise.all([
    ...[s.usdc.address, s.messageTransmitter.address, s.tokenMinter.address].map(address => client.readContract({ address, abi, functionName: "paused" }).then(v => !v)),
    ...[owner, s.tokenMinter.address, s.tokenMessenger.address].map(principal =>
      client.readContract({ address: s.usdc.address, abi, functionName: "isBlacklisted", args: [principal] }).then(v => !v)),
    client.readContract({ address: s.usdc.address, abi, functionName: "balanceOf", args: [owner] }).then(v => v >= amount),
    client.readContract({ address: s.messageTransmitter.address, abi, functionName: "localDomain" }).then(v => v === s.domain),
    client.readContract({ address: s.messageTransmitter.address, abi, functionName: "version" }).then(v => v === 1),
    client.readContract({ address: s.messageTransmitter.address, abi, functionName: "maxMessageBodySize" }).then(v => v >= 292n),
    client.readContract({ address: s.tokenMessenger.address, abi, functionName: "messageBodyVersion" }).then(v => v === 1),
    client.readContract({ address: s.tokenMessenger.address, abi, functionName: "localMessageTransmitter" }).then(v => v.toLowerCase() === s.messageTransmitter.address),
    client.readContract({ address: s.tokenMessenger.address, abi, functionName: "localMinter" }).then(v => v.toLowerCase() === s.tokenMinter.address),
    client.readContract({ address: s.tokenMessenger.address, abi, functionName: "remoteTokenMessengers", args: [26] }).then(v => v === pad(d.arc.tokenMessenger.address)),
    client.readContract({ address: s.tokenMinter.address, abi, functionName: "localTokenMessenger" }).then(v => v.toLowerCase() === s.tokenMessenger.address),
    client.readContract({ address: s.tokenMinter.address, abi, functionName: "burnLimitsPerMessage", args: [s.usdc.address] }).then(v => v >= amount),
  ]);
  if (checks.some(v => !v)) throw new Error("Fresh Circle source policy prevents this burn.");
  // No fallback: a qualified finalized-tag RPC is required, including for failed-source proof.
  await client.getBlock({ blockTag: "finalized" });
  return s.feePolicy === "fee-switch" ? client.readContract({ address: s.tokenMessenger.address, abi, functionName: "getMinFeeAmount", args: [amount] }) : 0n;
}
export async function evmStandardFee(d: EvmHelperIdentity, server: EvmHelperServer, amount: bigint, sourceMinimum: bigint) {
  const response = await fetch(`${server.irisApi}/v2/burn/USDC/fees/${d.source.domain}/26`, { cache: "no-store", signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok) throw new Error("Circle Standard fee unavailable.");
  const rows = z.array(z.object({ finalityThreshold: z.int(), minimumFee: z.union([z.string(), z.number().finite().nonnegative()]) })).max(20)
    .parse(JSON.parse(await boundedText(response, 16_384))).filter(row => row.finalityThreshold === 2000);
  if (rows.length !== 1) throw new Error("Circle Standard fee unavailable.");
  const iris = requiredManualFee(amount, rows[0].minimumFee, 0);
  return iris > sourceMinimum ? iris : sourceMinimum;
}

/** Circle AdminUpgradableProxy uses this OpenZeppelin EIP-1967 implementation slot. */
async function assertSourceImplementation(d: EvmHelperIdentity, client: ReturnType<typeof evmSourceClient>) {
  const messenger = d.source.tokenMessenger, implementation = messenger.implementation;
  const stored = await client.getStorageAt({ address: messenger.address,
    slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" });
  if (stored?.toLowerCase() !== pad(implementation.address)) throw new Error("Source implementation changed.");
  const code = await client.getCode({ address: implementation.address });
  if (!code || keccak256(code) !== implementation.runtimeHash) throw new Error("Source implementation runtime changed.");
}
