import { z } from "zod";
import { evmAddressSchema } from "../../evm/evm-schema";
import { cctpNetworks } from "./cctp-config";
import { CircleApiError } from "./circle-error";

const unsignedInteger = z.int().nonnegative();
const unsignedDecimal = z.string().regex(/^\d+$/);
const unixTimestamp = z.int().positive().max(Math.floor(Number.MAX_SAFE_INTEGER / 1000));
const hexPrefix = z.templateLiteral(["0x", z.string()]);
const signedQuote = z.string().regex(/^0x(?:[\da-f]{2})+$/i).pipe(hexPrefix);

export const cctpRequestSchema = z.object({
  network: z.enum(cctpNetworks),
  sender: evmAddressSchema,
  recipient: z.string(),
  amount: z.string(),
  deploymentId: z.string().optional(),
});

export const cctpAuthorizationSchema = cctpRequestSchema.extend({
  signedQuote,
  fee: unsignedDecimal,
});

const timestampExpiry = z.object({
  mode: z.literal("TIMESTAMP"),
  expiresAt: unixTimestamp,
});
const blockExpiry = z.object({
  mode: z.literal("BLOCK_NUMBER"),
  expiresAtBlock: z.int().positive(),
  blockEstimatedAt: unixTimestamp.optional(),
});
const quoteExpiry = z.discriminatedUnion("mode", [timestampExpiry, blockExpiry]);
const quoteMetadata = { issuedAt: unixTimestamp, expiry: quoteExpiry };

export const cctpQuoteSchema = cctpAuthorizationSchema.extend(quoteMetadata);
export const circleQuoteSchema = z.object({
  signedQuote,
  burnAmount: unsignedDecimal,
  feeToken: evmAddressSchema,
  feeTotalAmount: unsignedDecimal,
  ...quoteMetadata,
});

const expiryObservation = {
  expired: z.boolean(),
  secondsRemaining: unsignedInteger,
};
const validationExpiry = z.discriminatedUnion("mode", [
  timestampExpiry.extend({ expiresAt: unsignedInteger, ...expiryObservation }),
  blockExpiry.extend({
    expiresAtBlock: unsignedInteger,
    blockEstimatedAt: unsignedInteger.optional(),
    ...expiryObservation,
  }),
]);

export const circleValidationSchema = z.object({
  signedQuote,
  feeToken: evmAddressSchema,
  feeTotalAmount: unsignedDecimal,
  nonce: unsignedDecimal,
  claimable: z.boolean(),
  expiry: validationExpiry,
  failedChecks: z.array(z.string().min(1)),
  items: z.array(z.object({
    type: z.enum(["FORWARD", "PRE_FINALITY"]),
    argsMatch: z.boolean(),
  })).length(2),
});

export const cctpValidationSchema = z.object({
  claimable: z.boolean(),
  secondsRemaining: unsignedInteger,
});

export type CctpBurnIntent = z.infer<typeof cctpRequestSchema>;
export type CctpBurnAuthorization = z.infer<typeof cctpAuthorizationSchema>;
export type CctpQuote = z.infer<typeof cctpQuoteSchema>;
export type CctpQuoteExpiry = CctpQuote["expiry"];
export type CctpQuoteValidation = z.infer<typeof cctpValidationSchema>;
export type CircleValidation = z.infer<typeof circleValidationSchema>;

/** A timestamp deadline must follow issuance; block estimates never determine validity. */
export function assertQuoteExpiry(quote: Pick<CctpQuote, "issuedAt" | "expiry">): void {
  if (quote.expiry.mode !== "TIMESTAMP") return;
  if (quote.expiry.expiresAt <= quote.issuedAt) {
    throw new CircleApiError("invalid_response", "Circle returned invalid quote expiry metadata. Please retry.");
  }
}
