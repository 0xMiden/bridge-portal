import { bridgeConfigSchema } from "../../../config/wallet-config/schema";
import { z } from "zod";
import { isEvmNetwork } from "../../../config/evm-networks";
import { evmAddressSchema, hexDataSchema } from "../../evm/evm-schema";

const unsignedDecimal = z.string().regex(/^\d+$/);
const bytes32 = hexDataSchema.refine(value => value.length === 66);
const network = z.string().transform((value, context) => {
  if (isEvmNetwork(value)) return value;
  context.addIssue({ code: "custom", message: "Unsupported withdrawal network." });
  return z.NEVER;
});

export const withdrawalQuoteRequestSchema = z.object({
  network,
  amount: z.string(),
  sender: z.string(),
  recipient: evmAddressSchema,
  recovery: bridgeConfigSchema,
});

export const withdrawalQuoteSchema = withdrawalQuoteRequestSchema.extend({
  fee: unsignedDecimal,
  received: unsignedDecimal,
  expiresAt: z.int().positive(),
});

const withdrawalIntentSchema = z.object({
  maxFee: unsignedDecimal,
  spec: z.object({
    version: z.literal(1),
    sourceDomain: z.int().nonnegative(),
    destinationDomain: z.int().nonnegative(),
    destinationToken: bytes32,
    destinationRecipient: bytes32,
    value: unsignedDecimal,
    hookData: z.object({
      remoteDomain: z.int().nonnegative(),
      remoteDepositor: bytes32,
      remoteToken: bytes32,
      forwardingContractAddress: evmAddressSchema,
      forwardingCalldata: hexDataSchema,
    }),
  }),
});

export const circleWithdrawalQuoteSchema = z.object({
  batches: z.tuple([z.object({ burnIntents: z.tuple([withdrawalIntentSchema]) })]),
});

export type WithdrawalQuoteRequest = z.input<typeof withdrawalQuoteRequestSchema>;
export type ValidatedWithdrawalQuoteRequest = z.output<typeof withdrawalQuoteRequestSchema>;
export type WithdrawalQuote = z.infer<typeof withdrawalQuoteSchema>;
export type WithdrawalIntent = z.infer<typeof withdrawalIntentSchema>;
