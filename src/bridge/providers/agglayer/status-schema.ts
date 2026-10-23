import { z } from "zod";
import { transactionHashSchema } from "../../evm/evm-schema";

const hash = z.string().regex(/^0x[\da-f]{64}$/i);
const address = z.string().regex(/^0x[\da-f]{40}$/i);
const count = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative().safe()]);

// Older indexers omit fields until the corresponding stage is observed.
// Missing evidence stays missing; strings must never become truthy status flags.
const depositSchema = z.object({
  ready_for_claim: z.boolean().optional(),
  tx_hash: hash.optional(),
  claim_tx_hash: z.union([hash, z.literal("")]).optional(),
  amount: z.string().regex(/^\d+$/).optional(),
  deposit_cnt: count.optional(),
  block_num: count.optional(),
  global_index: z.string().regex(/^\d+$/).optional(),
  leaf_type: z.number().int().nonnegative().optional(),
  orig_net: z.number().int().nonnegative().optional(),
  orig_addr: address.optional(),
  dest_net: z.number().int().nonnegative().optional(),
  dest_addr: address.optional(),
  network_id: z.number().int().nonnegative().optional(),
  metadata: z.string().optional(),
});
export type AgglayerDeposit = z.infer<typeof depositSchema>;
export const depositPageSchema = z.object({
  deposits: z.array(depositSchema),
  total_cnt: count.optional(),
});
export const depositStatusSchema = z.object({
  destinationAddress: address,
  deposits: z.array(depositSchema),
  latestDeposit: depositSchema.nullable(),
});
export const withdrawalStatusSchema = z.object({ exitHashes: z.array(transactionHashSchema) });
export const chainObservationSchema = z.object({
  hash,
  status: z.enum(["pending", "confirmed", "unknown"]),
  confirmations: z.number().int().nonnegative().optional(),
  success: z.boolean().optional(),
  blockNumber: z.string().optional(),
});
export type ChainTxObservation = z.infer<typeof chainObservationSchema>;
