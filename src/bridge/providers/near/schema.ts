import { z } from "zod";
import { normalizeMidenAccountHex } from "../../miden-address";

export const nearCorrelationId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const nearAmount = z.string().regex(/^(0|[1-9]\d{0,77})$/);
// Only the basic-wallet interface is supported; arbitrary suffixes are not validated by account-ID decoding.
export const nearMidenAddress = z.string().max(256).regex(/^mm1[02-9ac-hj-np-z]+(?:_qr7qqq9wr6w)?$/).refine(value => {
  try { normalizeMidenAccountHex(value); return true; } catch { return false; }
}, "Invalid Miden mainnet address");

export const nearInputSchema = z.strictObject({
  routeId: z.string().min(1).max(200), mode: z.literal("send"),
  amount: z.string().min(1).max(80),
  midenAccount: nearMidenAddress,
  evmAddress: z.string().regex(/^0x[\da-f]{40}$/i).refine(value => !/^0x0{40}$/.test(value)),
});
export type NearInput = z.infer<typeof nearInputSchema>;

/** Keep all signed fields, including fields not rendered by the portal. */
export const nearQuoteSchema = z.looseObject({
  correlationId: nearCorrelationId, signature: z.string().max(160), timestamp: z.iso.datetime(),
  quoteRequest: z.looseObject({
    dry: z.boolean(), swapType: z.literal("EXACT_INPUT"), slippageTolerance: z.literal(100),
    originAsset: z.string().max(200), destinationAsset: z.string().max(200),
    depositType: z.literal("ORIGIN_CHAIN"), recipientType: z.literal("DESTINATION_CHAIN"), refundType: z.literal("ORIGIN_CHAIN"),
    amount: nearAmount, refundTo: nearMidenAddress, recipient: z.string().regex(/^0x[\da-f]{40}$/i),
    deadline: z.iso.datetime(), confidentiality: z.literal("basic"), quoteWaitingTimeMs: z.number().optional(),
  }),
  quote: z.looseObject({
    amountIn: nearAmount, amountInFormatted: z.string().max(100), amountInUsd: z.string().max(100), minAmountIn: nearAmount,
    amountOut: nearAmount, amountOutFormatted: z.string().max(100), amountOutUsd: z.string().max(100), minAmountOut: nearAmount,
    timeEstimate: z.number().finite().nonnegative().max(604800),
    depositAddress: nearMidenAddress.optional(), depositMemo: z.string().max(256).optional(),
    deadline: z.iso.datetime().optional(), timeWhenInactive: z.iso.datetime().optional(),
  }),
});
export type NearQuoteResponse = z.infer<typeof nearQuoteSchema>;
/** Revalidate reviewed terms at submission without allocating a second deposit address. */
export const nearPrepareInputSchema = nearInputSchema.extend({ quote: nearQuoteSchema.optional() });

export const nearStatusSchema = z.enum(["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"]);
export type NearStatus = z.infer<typeof nearStatusSchema>;
const tx = z.object({ hash: z.string().regex(/^0x[\da-f]{64}$/i) });
export const nearStatusResponseSchema = z.object({
  correlationId: nearCorrelationId, status: nearStatusSchema, quoteResponse: nearQuoteSchema,
  updatedAt: z.iso.datetime(),
  swapDetails: z.object({
    originChainTxHashes: z.array(tx).max(32), destinationChainTxHashes: z.array(tx).max(32),
    amountOut: nearAmount.optional(), refundedAmount: nearAmount.optional(),
    refundReason: z.string().max(256).nullish().transform(value => value ?? undefined),
  }),
});

export const nearOperationSchema = z.object({
  quote: nearQuoteSchema,
  submission: z.enum(["prepared", "attempted", "accepted", "confirmed"]),
  status: nearStatusSchema,
  notification: z.enum(["pending", "sent"]),
  networkFee: z.string().max(100).optional(),
  originTxHashes: z.array(z.string().regex(/^0x[\da-f]{64}$/i)).max(32).optional(),
  destinationTxHashes: z.array(z.string().regex(/^0x[\da-f]{64}$/i)).max(32).optional(),
  refundedAmount: z.string().max(100).optional(),
  refundReason: z.string().max(256).optional(),
});
export type NearOperation = z.infer<typeof nearOperationSchema>;

export const nearTrackingInputSchema = z.strictObject({ routeId: z.string().max(200), quote: nearQuoteSchema });
export const nearDepositInputSchema = nearTrackingInputSchema.extend({ txHash: z.string().regex(/^0x[\da-f]{64}$/i) });
