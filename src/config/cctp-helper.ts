import { z } from "zod";
import entries from "./cctp-helper-public.json";
import type { BridgeConfig } from "./bridge-config";
import { isSolanaBytes } from "../bridge/solana/identity";

export const CIRCLE_SOLANA_IDL_HASH = "46c195982ce970f90131f79e9b86eeadcb0d589d08f701f5506aa8ad4fa9e81d";
export const MANUAL_UNAVAILABLE = "Manual Solana deposits are not configured in this build.";
export const decimal = z.string().max(20).regex(/^(0|[1-9]\d*)$/);
export const bytes32 = z.templateLiteral(["0x", z.string().regex(/^[0-9a-f]{64}$/)]);
export const address = z.templateLiteral(["0x", z.string().regex(/^[0-9a-f]{40}$/)]).refine(value => BigInt(value) !== 0n);
export const solanaKey = z.string().max(44).refine(value => isSolanaBytes(value, 32));
export const solanaSignature = z.string().max(88).refine(value => isSolanaBytes(value, 64));
const contract = z.object({ address, runtimeHash: bytes32 }).strict();

/** Public deployment identity, never RPC URLs or credentials. Empty release registry is intentional. */
export const helperIdentitySchema = z.object({
  schemaVersion: z.literal(1), deploymentId: z.string().regex(/^[a-z0-9-]{1,80}$/),
  environment: z.enum(["mainnet", "testnet"]), enabled: z.boolean(),
  helper: contract.extend({ deploymentBlock: decimal, abiVersion: z.literal(1) }).strict(),
  arc: z.object({ chainId: z.union([z.literal(5042), z.literal(5042002)]),
    messageTransmitter: contract, tokenMessenger: contract, tokenMinter: contract, usdc: contract, xReserve: contract,
    gatewayWallet: contract, gatewayMinter: contract,
  }).strict(),
  miden: z.object({ domain: z.literal(10007), remoteDomainDepositor: address, faucetId: z.string().regex(/^0x[0-9a-f]{30}$/),
    recipientCodec: z.literal("miden-0.17.1-v1") }).strict(),
  source: z.object({ network: z.enum(["solana-mainnet", "solana-devnet"]), genesisHash: solanaKey,
    mint: solanaKey, tokenMessengerProgram: z.literal("CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe"),
    messageTransmitterProgram: z.literal("CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"),
    idlHash: z.literal(CIRCLE_SOLANA_IDL_HASH), finality: z.literal("finalized"),
    history: z.literal("unqualified"), startSlot: decimal,
  }).strict(),
}).strict();
export const helperDeploymentSchema = helperIdentitySchema.extend({
  qualification: z.object({ evidenceHash: bytes32, helperAsDepositor: z.literal(true), zeroRemoteFee: z.literal(true),
    arcRuntime: z.literal(true), phantomSignOnly: z.literal(true), sourcePrograms: z.literal(true) }).strict(),
}).strict().refine(value => value.environment === "mainnet"
  ? value.arc.chainId === 5042 && value.source.network === "solana-mainnet" && value.source.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  : value.arc.chainId === 5042002 && value.source.network === "solana-devnet" && value.source.mint === "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
"Source, Arc and Miden environments must agree.");

export type HelperIdentity = z.infer<typeof helperIdentitySchema>;
export type HelperDeployment = z.infer<typeof helperDeploymentSchema>;
export const helperDeployments = z.array(helperDeploymentSchema).parse(entries);
if (new Set(helperDeployments.map(entry => entry.deploymentId)).size !== helperDeployments.length)
  throw new Error("Duplicate helper deployment identity.");

export function assertHelperConfig(deployment: HelperDeployment, recovery: BridgeConfig) {
  if (deployment.environment !== recovery.environment || deployment.miden.faucetId !== recovery.derived.usdcxFaucetId)
    throw new Error("The manual deployment does not match this Bread network and faucet.");
}

export function getHelperDeployment(id: string, requireEnabled = false): HelperDeployment {
  const entry = helperDeployments.find(value => value.deploymentId === id);
  if (!entry || (requireEnabled && !entry.enabled)) throw new Error(MANUAL_UNAVAILABLE);
  return entry;
}
