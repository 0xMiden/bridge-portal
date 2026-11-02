import { encodeAbiParameters, type Hex } from "viem";
import { HELPER_MAX, type ManualQuote } from "./helper-types";

/** Mirrors the released AccountId v1 constructor; ownership/network validation stays with Bread/SDK. */
export function assertEmbeddedRecipient(value: string): asserts value is Hex {
  if (!/^0x[0-9a-f]{64}$/.test(value) || BigInt(value.slice(0, 34)) !== 0n) throw new Error("Invalid Miden recipient.");
  const prefix = BigInt(`0x${value.slice(34, 50)}`), suffix = BigInt(`0x${value.slice(50)}`);
  if (prefix >= 0xffffffff00000001n || (prefix & 15n) !== 1n) throw new Error("Invalid Miden recipient.");
  if (suffix >= (1n << 63n) || (suffix & 255n) !== 0n) throw new Error("Invalid Miden recipient.");
}
export function encodeHelperHook(recipient: string): Hex {
  assertEmbeddedRecipient(recipient);
  return encodeAbiParameters([{ type: "uint32" }, { type: "bytes32" }], [1, recipient]);
}
export function assertManualAmounts(quote: Pick<ManualQuote, "grossAmount" | "maxCctpFee" | "minimumNet">) {
  const amount = BigInt(quote.grossAmount), cap = BigInt(quote.maxCctpFee);
  if (amount <= 0n || amount > HELPER_MAX) throw new Error("Invalid manual transfer amount or fee cap.");
  if (cap < 0n || cap >= amount) throw new Error("Invalid manual transfer amount or fee cap.");
  if (BigInt(quote.minimumNet) !== amount - cap) throw new Error("Invalid manual transfer amount or fee cap.");
}
/** Iris decimal basis points are rounded up; Solana min_fee uses its separate exact source rule. */
export function requiredManualFee(amount: bigint, minimumFee: string | number, minFee: number): bigint {
  const rate = String(minimumFee);
  if (!/^(0|[1-9]\d*)(\.\d{1,12})?$/.test(rate) || !Number.isSafeInteger(minFee)) throw new Error("Circle fee is unavailable.");
  if (minFee < 0 || minFee > 0xffffffff) throw new Error("Circle fee is unavailable.");
  const [whole, fraction = ""] = rate.split(".");
  const denominator = 10n ** BigInt(fraction.length) * 10_000n;
  const numerator = BigInt(whole + fraction);
  const iris = (amount * numerator + denominator - 1n) / denominator;
  if (minFee && amount <= 1n) throw new Error("Amount is too small for the source fee policy.");
  const source = minFee ? (amount * BigInt(minFee) / 10_000_000n || 1n) : 0n;
  const fee = iris > source ? iris : source;
  if (fee >= amount) throw new Error("The required fee consumes the entire amount.");
  return fee;
}
