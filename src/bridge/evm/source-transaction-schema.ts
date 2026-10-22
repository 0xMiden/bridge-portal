import { z } from "zod";
import { evmAddressSchema, hexDataSchema, rpcQuantitySchema, transactionHashSchema } from "./evm-schema";

/** Recovery identity survives wallet repricing and must be valid before storage or use. */
export const sourceTransactionSchema = z.object({
  hash: transactionHashSchema,
  from: evmAddressSchema,
  nonce: z.int().nonnegative(),
  to: evmAddressSchema.nullable(),
  input: hexDataSchema,
  value: z.string().regex(/^\d+$/),
});

/** RPC quantities use hexadecimal; persisted identity uses a safe nonce and decimal value. */
export const rpcTransactionSchema = sourceTransactionSchema.extend({
  nonce: rpcQuantitySchema,
  value: rpcQuantitySchema,
  blockNumber: rpcQuantitySchema.nullable(),
});

export type SourceTransaction = z.infer<typeof sourceTransactionSchema>;
export type RpcTransaction = z.infer<typeof rpcTransactionSchema>;
