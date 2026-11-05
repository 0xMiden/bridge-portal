import { z } from "zod";
import { bytes32, decimal, helperDeploymentSchema, type HelperIdentity, solanaKey, solanaSignature } from "../../../config/cctp-helper";
import { arcCheckpointSchema, helperCompletionSchema } from "./helper-completion-types";

export const HELPER_MAX = 9223372034707292160n;
export const MANUAL_PENDING = "Waiting for Arc execution. Exporting a call does not deliver USDCx.";
export const MANUAL_WARNING = "The source USDC burn is irreversible. You must execute a separate transaction on Arc and pay Arc gas. This v1 route has no refund or recipient change. USDCx is not delivered by exporting the call.";
export const AUTOMATIC_HELPER_WARNING = "The source USDC burn is irreversible. A sponsor pays Arc gas when available; sponsorship and delivery times are not guaranteed. An independent funded Arc payer can complete a verified call. This route has no refund or recipient change.";
export const manualQuoteRequestSchema = z.object({ deploymentId: z.string().max(80), sourceDomain: z.literal(5),
  sourceAccount: solanaKey, grossAmount: decimal, midenRecipient: bytes32 }).strict();
export const manualQuoteSchema = manualQuoteRequestSchema.extend({ execution: z.enum(["manual", "automatic"]), maxCctpFee: decimal,
  minimumNet: decimal, checkedAt: z.iso.datetime(), arcAnchor: arcCheckpointSchema.optional() }).strict();
export type ManualQuote = z.infer<typeof manualQuoteSchema>;
export const manualAuthorizationSchema = manualQuoteSchema.extend({ deployment: helperDeploymentSchema, finality: z.literal(2000) }).strict();
export type SourceAuthorization = ManualQuote & { deployment: HelperIdentity; finality: 2000 };
export type ManualAuthorization = z.infer<typeof manualAuthorizationSchema>;
export const sourceEvidenceSchema = z.object({ sourceTransaction: solanaSignature, slot: decimal,
  sourceEventIds: z.array(z.string().max(150)).length(1), eventAccount: solanaKey, sourceAccount: solanaKey,
  grossAmount: decimal, maxCctpFee: decimal, midenRecipient: bytes32, message: z.templateLiteral(["0x", z.string().regex(/^[0-9a-f]{880}$/)]),
}).strict();
export type ManualSourceEvidence = z.infer<typeof sourceEvidenceSchema>;
export const manualBundleSchema = z.object({ schemaVersion: z.literal(1), execution: z.literal("manual"),
  deployment: helperDeploymentSchema, source: sourceEvidenceSchema, cctpNonce: bytes32,
  message: z.templateLiteral(["0x", z.string().regex(/^[0-9a-f]{880}$/)]),
  messageHash: bytes32.optional(), attestationHash: bytes32.optional(),
  simulation: z.object({ status: z.literal("passed"), checkedAt: z.iso.datetime() }).strict().optional(),
  attestation: z.templateLiteral(["0x", z.string().max(26_000).regex(/^(?:[0-9a-f]{130})+$/)]),
  maxCctpFee: decimal, feeExecuted: decimal, netAmount: decimal, checkedAt: z.iso.datetime(),
  simulationCaller: z.templateLiteral(["0x", z.string().regex(/^[0-9a-f]{40}$/)]),
  call: z.object({ to: z.templateLiteral(["0x", z.string().regex(/^[0-9a-f]{40}$/)]), value: z.literal("0"),
    function: z.literal("receiveAndDeposit(bytes,bytes)"), data: z.templateLiteral(["0x", z.string().max(32_000).regex(/^[0-9a-f]+$/)]) }).strict(),
  notice: z.union([z.literal(MANUAL_PENDING), z.literal("A separate transaction on Arc is still required. USDCx has not been delivered.")]),
  revalidation: z.literal("The executor must independently revalidate and simulate this call before spending Arc gas."),
}).strict();
export type ManualBundle = z.infer<typeof manualBundleSchema>;
export const manualObservationSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending"), reason: z.enum(["source_unconfirmed", "attestation_pending"]), source: sourceEvidenceSchema.optional() }).strict(),
  z.object({ state: z.literal("needs_attention"), reason: z.enum(["history_unavailable", "source_mismatch", "correlation_ambiguous", "attestation_invalid", "destination_unavailable", "historical_deployment_unavailable"]) }).strict(),
  z.object({ state: z.literal("source_failed"), sourceTransaction: solanaSignature, slot: decimal, error: z.string().max(400) }).strict(),
  z.object({ state: z.literal("ready"), bundle: manualBundleSchema }).strict(),
  z.object({ schemaVersion: z.literal(2), state: z.literal("tracking"), bundle: manualBundleSchema, completion: helperCompletionSchema }).strict(),
  z.object({ schemaVersion: z.literal(2), state: z.literal("source_verified"), source: sourceEvidenceSchema }).strict(),
]);
export type ManualObservation = z.infer<typeof manualObservationSchema>;
export const helperActivitySchema = z.object({ schemaVersion: z.union([z.literal(1), z.literal(2)]), execution: z.enum(["manual", "automatic"]),
  authorization: manualAuthorizationSchema, attemptId: z.string().min(1).max(80),
  stage: z.enum(["reviewed", "signing", "signed", "source_unknown", "source_finalized", "needs_attention", "ready", "source_failed", "attested", "arc_deposited", "reserve_attested", "delivered"]),
  eventAccount: solanaKey, scanStartSlot: decimal, blockhash: solanaKey.optional(), lastValidBlockHeight: decimal.optional(),
  signature: solanaSignature.optional(), signedBytes: z.string().max(1700).regex(/^[A-Za-z0-9+/]+={0,2}$/).optional(),
  sourceEvidence: sourceEvidenceSchema.optional(), bundle: manualBundleSchema.optional(), reason: z.string().max(400).optional(),
  failedSlot: decimal.optional(), sourceFeeLamports: decimal.optional(), eventRentLamports: decimal.optional(),
  recoveryOnly: z.boolean().optional(), completion: helperCompletionSchema.optional(),
}).strict().superRefine((helper, context) => {
  validateSubmissionMetadata(helper, context);
  if (helper.stage !== "source_failed") return;
  for (const field of ["signature", "failedSlot"] as const) {
    if (helper[field] === undefined) context.addIssue({ code: "custom", path: [field], message: "A finalized source failure requires its exact signature and slot." });
  }
  for (const field of ["signedBytes", "sourceEvidence", "bundle"] as const) {
    if (helper[field] !== undefined) context.addIssue({ code: "custom", path: [field], message: "A source failure cannot retain pending bytes or successful source evidence." });
  }
});
export type HelperActivity = z.infer<typeof helperActivitySchema>;

type SubmissionMetadata = { recoveryOnly?: boolean; signature?: string; sourceEvidence?: unknown; signedBytes?: string;
  blockhash?: string; lastValidBlockHeight?: string; sourceFeeLamports?: string; eventRentLamports?: string };
function validateSubmissionMetadata(helper: SubmissionMetadata, context: z.RefinementCtx) {
  const fields = ["blockhash", "lastValidBlockHeight", "sourceFeeLamports", "eventRentLamports"] as const;
  if (!helper.recoveryOnly) {
    validateRequiredMetadata(helper, context);
    return;
  }
  if (!helper.signature || !helper.sourceEvidence) context.addIssue({ code: "custom", message: "Imported recovery requires finalized successful source evidence." });
  for (const field of [...fields, "signedBytes"] as const) if (helper[field] !== undefined)
    context.addIssue({ code: "custom", path: [field], message: "Imported recovery cannot invent submission metadata or signed bytes." });
}
function validateRequiredMetadata(helper: SubmissionMetadata, context: z.RefinementCtx) {
  for (const field of ["blockhash", "lastValidBlockHeight", "sourceFeeLamports", "eventRentLamports"] as const) if (helper[field] === undefined)
    context.addIssue({ code: "custom", path: [field], message: "Saved signing attempts require original submission metadata." });
}

/** Old manual readiness means attested and waiting, never delivered. */
export function migrateHelperActivity(helper: HelperActivity): HelperActivity {
  if (helper.schemaVersion === 2) return helper;
  return { ...helper, schemaVersion: 2, execution: "automatic", authorization: { ...helper.authorization, execution: "automatic" },
    stage: helper.stage === "ready" ? "attested" : helper.stage };
}
