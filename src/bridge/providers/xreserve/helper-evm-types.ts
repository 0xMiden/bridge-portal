import { bridgeConfigSchema } from "../../../config/wallet-config/schema";
import { z } from "zod";
import { address, bytes32, decimal } from "../../../config/cctp-helper";
import { evmHelperDeploymentSchema } from "../../../config/cctp-evm-helper";
import { manualBundleSchema } from "./helper-types";
export const evmManualRequestSchema = z.object({ deploymentId: z.string().max(80), sourceAccount: address,
  grossAmount: decimal, midenRecipient: bytes32 }).strict();
export const evmManualQuoteSchema = evmManualRequestSchema.extend({ runtime: z.literal("evm"), execution: z.literal("manual"),
  maxCctpFee: decimal, minimumNet: decimal, checkedAt: z.iso.datetime() }).strict();
export const evmManualAuthorizationSchema = evmManualQuoteSchema.extend({ deployment: evmHelperDeploymentSchema, finality: z.literal(2000) }).strict();
export type EvmManualAuthorization = z.infer<typeof evmManualAuthorizationSchema>;
export const evmSourceSchema = z.object({ sourceTransaction: bytes32, blockHash: bytes32, blockNumber: decimal,
  logIndex: z.int().nonnegative(), sourceAccount: address, grossAmount: decimal, maxCctpFee: decimal,
  midenRecipient: bytes32, message: manualBundleSchema.shape.message }).strict();
export const evmBundleSchema = manualBundleSchema.omit({ source: true, deployment: true }).extend({
  deployment: evmHelperDeploymentSchema, source: evmSourceSchema,
}).strict();
export type EvmManualBundle = z.infer<typeof evmBundleSchema>;
export const evmHelperActivitySchema = z.object({ schemaVersion: z.literal(1), runtime: z.literal("evm"),
  recovery: bridgeConfigSchema, attemptId: z.string().min(1).max(80), intent: z.string().max(1500), authorization: evmManualAuthorizationSchema,
  stage: z.enum(["wallet_pending", "source_unknown", "source_finalized", "needs_attention", "ready", "source_failed"]),
  startBlock: decimal, requestedNonce: z.int().nonnegative(), callData: z.templateLiteral(["0x", z.string().max(4000).regex(/^[0-9a-f]+$/)]),
  hash: bytes32.optional(), hashOrigin: z.enum(["wallet", "imported"]).optional(), candidateHashes: z.array(bytes32).max(100).optional(), source: evmSourceSchema.optional(), bundle: evmBundleSchema.optional(),
  reason: z.string().max(400).optional(), failedBlock: decimal.optional(), failedBlockHash: bytes32.optional(),
}).strict().superRefine((row, ctx) => {
  if (row.stage !== "source_failed") return;
  if (!row.hash || row.hashOrigin !== "wallet") ctx.addIssue({ code: "custom", message: "Finalized failure requires a wallet-returned transaction hash." });
  if (!row.failedBlock || !row.failedBlockHash) ctx.addIssue({ code: "custom", message: "Finalized failure requires canonical block evidence." });
  if (row.stage === "source_failed" && (row.source || row.bundle))
    ctx.addIssue({ code: "custom", message: "Failed source cannot retain successful burn evidence." });
});
export type EvmHelperActivity = z.infer<typeof evmHelperActivitySchema>;
export const evmObservationSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending") }).strict(),
  z.object({ state: z.literal("needs_attention"), reason: z.string().max(400) }).strict(),
  z.object({ state: z.literal("source_failed"), hash: bytes32, blockNumber: decimal, blockHash: bytes32 }).strict(),
  z.object({ state: z.literal("source_finalized"), source: evmSourceSchema }).strict(),
  z.object({ state: z.literal("ready"), bundle: evmBundleSchema }).strict(),
]);
export type EvmObservation = z.infer<typeof evmObservationSchema>;
