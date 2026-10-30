import { z } from "zod";
import { solanaKey, solanaSignature } from "../../config/cctp-helper";
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const commitment = z.enum(["confirmed", "finalized"]);
const context = z.object({ commitment, minContextSlot: integer.optional() }).strict();
const account = context.extend({ encoding: z.literal("base64") }).strict();
const encoded = z.string().max(1644).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const base = { jsonrpc: z.literal("2.0"), id: z.union([z.string().max(80), integer]) };
const method = <M extends string, P extends z.ZodType>(name: M, params: P) => z.object({ ...base, method: z.literal(name), params }).strict();
export const manualRpcRequestSchema = z.discriminatedUnion("method", [
  method("getGenesisHash", z.tuple([])), method("getAccountInfo", z.tuple([solanaKey, account])),
  method("getMultipleAccounts", z.tuple([z.array(solanaKey).min(1).max(20), account])), method("getBalance", z.tuple([solanaKey, context])),
  method("getLatestBlockhash", z.tuple([context])), method("getSlot", z.tuple([context])), method("getBlockHeight", z.tuple([context])),
  method("getMinimumBalanceForRentExemption", z.tuple([z.literal(492), z.object({ commitment }).strict()])),
  method("getFeeForMessage", z.tuple([encoded, z.object({ commitment }).strict()])),
  method("getSignatureStatuses", z.tuple([z.array(solanaSignature).length(1), z.object({ searchTransactionHistory: z.literal(true) }).strict()])),
  method("getTransaction", z.tuple([solanaSignature, z.object({ commitment: z.literal("finalized"), maxSupportedTransactionVersion: z.literal(1), encoding: z.literal("json").optional() }).strict()])),
  method("simulateTransaction", z.tuple([encoded, z.object({ encoding: z.literal("base64"), commitment: z.literal("confirmed"),
    sigVerify: z.literal(false), replaceRecentBlockhash: z.literal(false) }).strict()])),
  // web3.js1.99 omits this field when false. Normalize that safe RPC default;
  // the proxy forwards only this parsed object, never the original request body.
  method("sendTransaction", z.tuple([encoded, z.object({ encoding: z.literal("base64"), skipPreflight: z.literal(false).default(false),
    preflightCommitment: z.literal("confirmed"), maxRetries: z.literal(0) }).strict()])),
]);
