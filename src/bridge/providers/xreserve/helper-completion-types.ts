import { z } from "zod";
import { address, bytes32, decimal } from "../../../config/cctp-helper";

export const arcCheckpointSchema = z.object({ block: decimal, hash: bytes32 }).strict();
export const arcScanSchema = z.object({ nextBlock: decimal, checkpoint: arcCheckpointSchema }).strict();
export const helperCompletionSchema = z.object({
  schemaVersion: z.literal(1),
  stage: z.enum(["attested", "arc_deposited", "reserve_attested"]),
  scan: arcScanSchema.optional(),
  catchingUp: z.boolean(),
  warning: z.string().max(400).optional(),
  needsAttention: z.boolean().optional(),
  candidates: z.array(z.object({ payload: z.templateLiteral(["0x", z.string().max(480).regex(/^[0-9a-f]+$/)]),
    messageHash: bytes32, nonce: bytes32 }).strict()).max(64).optional(),
  arc: z.object({ transactionHash: bytes32, block: decimal, blockHash: bytes32,
    helperLogIndex: z.int().nonnegative(), messageLogIndex: z.int().nonnegative(), reserveLogIndex: z.int().nonnegative(),
  }).strict().optional(),
  intent: z.object({ amount: decimal, recipient: z.string().regex(/^0x[0-9a-f]{30}$/),
    faucet: z.string().regex(/^0x[0-9a-f]{30}$/), sender: address, nonce: bytes32,
    payload: z.templateLiteral(["0x", z.string().max(480).regex(/^[0-9a-f]+$/)]), messageHash: bytes32,
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.stage !== "attested" && !value.arc) context.addIssue({ code: "custom", message: "Destination progress requires its verified Arc receipt." });
  if (value.stage === "reserve_attested" && !value.intent) context.addIssue({ code: "custom", message: "Reserve progress requires its distinct authorization." });
  if (value.intent && value.stage !== "reserve_attested") context.addIssue({ code: "custom", message: "Selected authorization requires verified reserve progress." });
  if (value.needsAttention && value.intent) context.addIssue({ code: "custom", message: "Ambiguous authorization cannot select a reserve nonce." });
});
export type ArcCheckpoint = z.infer<typeof arcCheckpointSchema>;
export type ArcScan = z.infer<typeof arcScanSchema>;
export type HelperCompletion = z.infer<typeof helperCompletionSchema>;
