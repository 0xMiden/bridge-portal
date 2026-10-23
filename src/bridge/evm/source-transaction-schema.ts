import { z } from "zod";
import { evmAddressSchema, hexDataSchema, transactionHashSchema } from "./evm-schema";

/** Recovery identity survives wallet repricing and must be valid before storage or use. */
export const sourceTransactionSchema = z.object({
  hash: transactionHashSchema,
  from: evmAddressSchema,
  nonce: z.int().nonnegative(),
  to: evmAddressSchema.nullable(),
  input: hexDataSchema,
  value: z.string().regex(/^\d+$/),
});

export type SourceTransaction = z.infer<typeof sourceTransactionSchema>;
