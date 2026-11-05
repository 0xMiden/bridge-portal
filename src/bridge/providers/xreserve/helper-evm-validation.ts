import { encodeFunctionData, pad, type Hex, type Transaction } from "viem";
import { evmHelperCallData } from "./helper-evm-call";
import { evmBundleSchema, type EvmManualAuthorization, type EvmHelperActivity } from "./helper-evm-types";
import { decodeCctpMessage, matchAttestedMessage } from "./cctp-message";
import { encodeHelperHook } from "./helper-hook";
import { configKey } from "../../../config/bridge-config";
import { helperAbi } from "./helper-abi";
export function assertEvmSourceMessage(message: Hex, auth: EvmManualAuthorization) {
  const t = decodeCctpMessage(message).transfer, d = auth.deployment, s = d.source;
  const expected = { version: 1, burnVersion: 1, sourceDomain: s.domain, destinationDomain: 26,
    sender: pad(s.tokenMessenger.address), recipient: pad(d.arc.tokenMessenger.address),
    destinationCaller: pad(d.helper.address), mintRecipient: pad(d.helper.address), burnToken: pad(s.usdc.address),
    messageSender: pad(auth.sourceAccount), amount: BigInt(auth.grossAmount), maxFee: BigInt(auth.maxCctpFee),
    minFinalityThreshold: 2000, hookData: encodeHelperHook(auth.midenRecipient) };
  for (const [key, value] of Object.entries(expected)) {
    if (t[key as keyof typeof t] !== value) throw new Error("Source CCTP message does not match the review.");
  }
}
export function assertEvmSourceTransaction(tx: Pick<Transaction, "from" | "to" | "input" | "value">, auth: EvmManualAuthorization) {
  if (tx.from.toLowerCase() !== auth.sourceAccount || tx.to?.toLowerCase() !== auth.deployment.source.tokenMessenger.address)
    throw new Error("Source transaction endpoint mismatch.");
  if (tx.value !== 0n || tx.input.toLowerCase() !== evmHelperCallData(auth)) throw new Error("Source transaction call mismatch.");
}

export function validateEvmBundle(value: unknown, row: EvmHelperActivity) {
  const bundle = evmBundleSchema.parse(value), auth = row.authorization, source = bundle.source;
  if (configKey(bundle.deployment) !== configKey(auth.deployment) || source.sourceTransaction !== row.hash) throw new Error("Manual bundle identity mismatch.");
  if (BigInt(source.blockNumber) < BigInt(row.startBlock)) throw new Error("Source predates this attempt.");
  for (const key of ["sourceAccount", "grossAmount", "maxCctpFee", "midenRecipient"] as const)
    if (source[key] !== auth[key]) throw new Error("Manual bundle terms mismatch.");
  assertEvmSourceMessage(source.message, auth);
  const original = decodeCctpMessage(source.message), attested = decodeCctpMessage(bundle.message);
  if (!matchAttestedMessage(original, attested) || attested.finalityThresholdExecuted < 2000 || attested.expirationBlock !== 0n)
    throw new Error("Manual bundle finality mismatch.");
  if (BigInt(attested.nonce) === 0n || attested.nonce !== bundle.cctpNonce) throw new Error("Manual bundle nonce mismatch.");
  const fee = attested.feeExecuted, net = BigInt(auth.grossAmount) - fee;
  if (fee > BigInt(auth.maxCctpFee) || net <= 0n || bundle.maxCctpFee !== auth.maxCctpFee) throw new Error("Manual bundle fee mismatch.");
  if (bundle.feeExecuted !== fee.toString() || bundle.netAmount !== net.toString()) throw new Error("Manual bundle amount mismatch.");
  const data = encodeFunctionData({ abi: helperAbi, functionName: "receiveAndDeposit", args: [bundle.message, bundle.attestation] });
  if (bundle.call.to !== auth.deployment.helper.address || bundle.call.data !== data) throw new Error("Manual handoff calldata mismatch.");
  return bundle;
}
