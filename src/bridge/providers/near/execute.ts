import { quoteHash, type QuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import type { SubmissionContext } from "../../core/submission";
import { normalizeMidenAccountHex } from "../../miden-address";
import { getMidenVerificationBaseFee } from "../../miden-rpc";
import { nearInput, nearPair, nearSourceUnits, verifyNearQuote } from "./quote";
import { nearPost } from "./client";
import type { NearQuoteResponse } from "./schema";

export function validateNearDeposit(quote: NearQuoteResponse) {
  if (quote.quoteRequest.dry || !quote.quote.depositAddress) throw new Error("Review an executable NEAR quote before sending.");
  // Public P2ID deposits need no attachment. Never silently drop a provider memo.
  if (quote.quote.depositMemo || quote.quote.depositAttachment || quote.quote.attachment) {
    throw new Error("This NEAR deposit requires unsupported memo or attachment instructions. Do not fund it.");
  }
  return quote.quote.depositAddress;
}

async function checkBalance(context: SubmissionContext, units: bigint) {
  const { route, input } = context;
  const pair = nearPair(route.id);
  if (!input.midenWallet.requestAssets) throw new Error("Reconnect Bread to verify your source and fee balances.");
  const [assets, baseFee] = await Promise.all([input.midenWallet.requestAssets(), getMidenVerificationBaseFee(route.recovery)]);
  const balance = (faucet: string) => assets.reduce((total, asset) =>
    normalizeMidenAccountHex(asset.faucetId) === normalizeMidenAccountHex(faucet) ? total + BigInt(asset.amount) : total, 0n);
  const fee = BigInt(baseFee) * 30n;
  const feeFaucet = route.recovery.derived.usdcxFaucetId;
  const reserve = pair.source.faucetId === feeFaucet ? fee : 0n;
  if (balance(pair.source.faucetId) < units + reserve || balance(feeFaucet) < fee) {
    throw new Error("Not enough source tokens or USDCx for the Miden network fee.");
  }
}

/** Once a wallet attempt is durably claimed, only tracking may resume it. */
export async function submitNearTransfer(context: SubmissionContext) {
  const { input, route } = context;
  if (route.provider !== "near" || route.mode !== "send") throw new Error("NEAR only supports Send from Miden.");
  if (input.quote?.kind !== "near") throw new Error("Review an executable NEAR quote before sending.");
  const binding = nearInput({ route, ...input });
  const quote = verifyNearQuote(input.quote.authorization, binding, false);
  validateNearDeposit(quote);
  const id = `act-near-${quoteHash(quote as unknown as QuoteResponse)}`;
  if (!context.persist || !context.findActivity || !globalThis.navigator?.locks) {
    throw new Error("Durable receipt storage and browser locks are required before sending.");
  }
  await navigator.locks.request(id, async () => {
    const existing = context.findActivity!(id);
    if (existing?.near?.submission && existing.near.submission !== "prepared") {
      context.record(existing);
      return;
    }
    const units = BigInt(nearSourceUnits(input.amount, nearPair(route.id).source.decimals));
    context.phase("Checking Miden balance and fee…");
    await checkBalance(context, units);
    // Recheck the server kill switch immediately before constructing a wallet request.
    await nearPost("prepare", { ...binding, quote });
    const { buildNearDeposit } = await import("./funding");
    const deposit = buildNearDeposit(quote, binding, route.recovery);
    verifyNearQuote(quote, binding, false);
    if (!input.midenWallet.requestTransaction || !input.midenWallet.waitForTransaction) throw new Error("Reconnect Bread before transferring.");
    const operation = { quote, submission: "prepared" as const, status: "PENDING_DEPOSIT" as const, notification: "pending" as const };
    context.persist!({ id, near: operation, midenNoteId: deposit.noteId, receivedAmount: input.quote!.received,
      evmAddress: input.evmAddress, midenAccount: input.midenAccount });
    // Persist the attempt BEFORE invoking the extension. A lost response must not retry it.
    context.persist!({ near: { ...operation, submission: "attempted" } });
    context.phase("Confirm the public deposit in Bread…");
    const requestId = await input.midenWallet.requestTransaction(deposit.transaction);
    context.update({ midenWalletRequestId: requestId, near: { ...operation, submission: "accepted" } });
    const confirmed = await input.midenWallet.waitForTransaction(requestId);
    if (!confirmed.outputNotes?.some(note => note.id().toString() === deposit.noteId) || !/^0x[\da-f]{64}$/i.test(confirmed.txHash)) {
      throw new Error("The wallet response could not confirm this deposit. Keep the receipt and check its status.");
    }
    context.update({ sourceTxHash: confirmed.txHash, midenTxId: confirmed.txHash, near: { ...operation, submission: "confirmed" } });
    // Notification is only an acceleration hint. Failure cannot lead to another wallet call.
    try {
      await nearPost("deposit/submit", { routeId: route.id, quote, txHash: confirmed.txHash });
      context.update({ near: { ...operation, submission: "confirmed", notification: "sent" } });
    } catch { /* Tracking retries the notification from this receipt. */ }
  });
}
