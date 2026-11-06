import sources from "./cctp-evm-sources.json";
import { z } from "zod";
import entries from "./cctp-evm-helper-public.json";
import { address, decimal, helperIdentitySchema, bytes32, assertHelperConfig } from "./cctp-helper";
import { isEvmNetwork } from "./evm-networks";
import type { EvmNetwork } from "../bridge/core/assets";

export const EVM_HELPER_UNAVAILABLE = "This CCTP source has no qualified manual Arc deployment in this build.";
const contract = z.object({ address, runtimeHash: bytes32 }).strict();
export const evmHelperIdentitySchema = helperIdentitySchema.omit({ source: true }).extend({
  source: z.object({ runtime: z.literal("evm"), network: z.custom<EvmNetwork>(value => typeof value === "string" && isEvmNetwork(value)),
    chainId: z.int().positive(), domain: z.int().nonnegative().max(0xffffffff), usdc: contract,
    tokenMessenger: contract.extend({ implementation: contract }).strict(), messageTransmitter: contract, tokenMinter: contract,
    startBlock: decimal, finality: z.literal("finalized"), feePolicy: z.enum(["legacy-zero-standard", "fee-switch"]),
  }).strict(),
}).strict();
export const evmHelperDeploymentSchema = evmHelperIdentitySchema.extend({
  qualification: z.object({ evidenceHash: bytes32, helperAsDepositor: z.literal(true), zeroRemoteFee: z.literal(true),
    arcRuntime: z.literal(true), sourceRuntime: z.literal(true), sourceFeePolicy: z.literal(true), finalizedRpc: z.literal(true), walletSend: z.literal(true) }).strict(),
}).strict().superRefine((d, ctx) => {
  const s = d.source, row = sources.find(row => row.network === s.network && row.environment === d.environment);
  if (!row || row.domain === 26) { ctx.addIssue({ code: "custom", message: "Unsupported native CCTP source." }); return; }
  for (const [actual, expected] of [[s.chainId, row.chainId], [s.domain, row.domain], [s.usdc.address, row.usdc],
    [s.tokenMessenger.address, row.tokenMessenger], [s.messageTransmitter.address, row.messageTransmitter], [s.tokenMinter.address, row.tokenMinter]]) {
    if (actual !== expected) ctx.addIssue({ code: "custom", message: "Source deployment differs from verified Circle catalog." });
  }
  if (row.feePolicy !== "unqualified" && row.feePolicy !== s.feePolicy) ctx.addIssue({ code: "custom", message: "Source fee policy mismatch." });
  if (d.arc.chainId !== (d.environment === "mainnet" ? 5042 : 5042002)) ctx.addIssue({ code: "custom", message: "Arc/source environments differ." });
});
export type EvmHelperIdentity = z.infer<typeof evmHelperIdentitySchema>;
export type EvmHelperDeployment = z.infer<typeof evmHelperDeploymentSchema>;
export type HelperDestination = Pick<EvmHelperIdentity, "helper" | "arc" | "miden" | "environment">;
export const evmHelperDeployments = z.array(evmHelperDeploymentSchema).parse(entries);
if (new Set(evmHelperDeployments.map(entry => entry.deploymentId)).size !== evmHelperDeployments.length)
  throw new Error("Duplicate EVM helper deployment identity.");
export function getEvmHelperDeployment(id: string, enabled = false) {
  const entry = evmHelperDeployments.find(row => row.deploymentId === id);
  if (!entry || enabled && !entry.enabled) throw new Error(EVM_HELPER_UNAVAILABLE);
  return entry;
}
export { assertHelperConfig };
