import { quoteHash, type QuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { formatUnits } from "viem";
import { isEvmAsset } from "../../core/assets";
import type { SubmissionContext } from "../../core/submission";
import { assertRecipientAccount } from "../../../wallets/bridge-wallet";
import { isUserRejection } from "../../../wallets/errors";
import { prepareBitcoinDeposit } from "./bitcoin-deposit";
import { normalizeMidenAccountHex } from "../../miden-address";
import { getMidenVerificationBaseFee } from "../../miden-rpc";
import { nearInput, nearPair, nearQuoteExpiry, validateNearDeposit, validateNearTxHash, verifyNearQuote } from "./quote";
import { nearPost } from "./client";
import type { NearInput, NearOperation, NearQuoteResponse } from "./schema";

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
  return `${formatUnits(fee, 6)} USDCx`;
}

/** Save the reviewed transfer and durably claim the attempt before opening the wallet. */
async function claimDeposit(context: SubmissionContext, id: string, quote: NearQuoteResponse, networkFee: string, midenNoteId?: string) {
  const { input, route } = context;
  const operation: NearOperation = { quote, networkFee, submission: "prepared", status: "PENDING_DEPOSIT", notification: "pending" };
  await context.persist({
    id, near: operation, midenNoteId, eta: `About ${quote.quote.timeEstimate} seconds`,
    destination: quote.quoteRequest.recipient, midenAccount: input.midenAccount,
    evmAddress: input.externalWallet.family === "evm" ? input.externalAddress : undefined,
    midenAccountHex: route.mode === "receive" ? normalizeMidenAccountHex(input.midenAccount) : undefined,
  });
  await context.persist({ near: { ...operation, submission: "attempted" } });
  return operation;
}

function assertBreadAccount({ input }: SubmissionContext) {
  if (!input.midenWallet.assertAccount) throw new Error("Reconnect Bread to verify your account.");
  input.midenWallet.assertAccount(input.midenAccount);
}

async function requestFunding(context: SubmissionContext, operation: NearOperation, assertExternal: () => Promise<void>, send: () => Promise<string>) {
  try {
    // Saving the claim can wait behind another tab's storage lock.
    await assertExternal();
    assertBreadAccount(context);
    if (nearQuoteExpiry(operation.quote) <= Date.now()) throw new Error("NEAR quote expired. Review a fresh quote.");
  } catch (error) {
    await context.persist({ near: { ...operation, submission: "not_sent" } });
    throw error;
  }
  try { return await send(); }
  catch (error) {
    // Only the original wallet request can prove the payment was declined.
    // A lost response or an error while waiting for confirmation stays trackable.
    if (isUserRejection(error)) await context.persist({ near: { ...operation, submission: "declined" } });
    throw error;
  }
}

async function notifyDeposit(context: SubmissionContext, operation: NearOperation, txHash: string) {
  try {
    await nearPost("deposit/submit", { routeId: context.route.id, quote: operation.quote, txHash });
    context.update({ near: { ...operation, notification: "sent" } });
  } catch { /* The monitor retries this notification without requesting another payment. */ }
}

async function prepareExternalDeposit(context: SubmissionContext, quote: NearQuoteResponse) {
  const source = context.route.source;
  if (source.network === "bitcoin") return prepareBitcoinDeposit(context.input, quote);
  if (isEvmAsset(source)) {
    const { prepareEvmDeposit } = await import("./evm-deposit");
    return prepareEvmDeposit(context, quote);
  }
  throw new Error("This network does not support external deposits.");
}

async function submitExternalDeposit(context: SubmissionContext, binding: NearInput, quote: NearQuoteResponse, id: string) {
  const deposit = await prepareExternalDeposit(context, quote);
  await nearPost("prepare", { ...binding, quote });
  await deposit.assertWallet();
  assertBreadAccount(context);
  verifyNearQuote(quote, binding, false);
  const operation = await claimDeposit(context, id, quote, deposit.networkFee);
  context.phase(deposit.prompt);
  const hash = await requestFunding(context, operation, deposit.assertWallet, deposit.send);
  const sourceTxHash = validateNearTxHash(context.route.source, hash);
  const accepted = { ...operation, submission: "accepted" as const };
  await context.persist({ sourceTxHash, near: accepted });
  const source = context.route.source;
  async function saveEvmIdentity() {
    if (!isEvmAsset(source)) return;
    const { captureSourceTransaction } = await import("../../evm/source-transaction");
    const sourceTransaction = await captureSourceTransaction(source.network, sourceTxHash).catch(() => undefined);
    if (sourceTransaction) context.update({ sourceTransaction });
  }
  await Promise.all([saveEvmIdentity(), notifyDeposit(context, accepted, sourceTxHash)]);
}

async function submitMidenDeposit(context: SubmissionContext, binding: NearInput, quote: NearQuoteResponse, id: string) {
  const { input, route } = context;
  context.phase("Checking Miden balance and fee…");
  const networkFee = await checkBalance(context, BigInt(quote.quote.amountIn));
  await nearPost("prepare", { ...binding, quote });
  const { buildNearDeposit } = await import("./funding");
  const deposit = buildNearDeposit(quote, binding, route.recovery);
  await assertRecipientAccount(input);
  assertBreadAccount(context);
  verifyNearQuote(quote, binding, false);
  if (!input.midenWallet.requestTransaction || !input.midenWallet.waitForTransaction) throw new Error("Reconnect Bread before transferring.");
  const operation = await claimDeposit(context, id, quote, networkFee, deposit.noteId);
  context.phase("Confirm the public deposit in Bread…");
  const requestId = await requestFunding(context, operation, () => assertRecipientAccount(input), () => input.midenWallet.requestTransaction!(deposit.transaction));
  context.update({ midenWalletRequestId: requestId, near: { ...operation, submission: "accepted" } });
  const confirmed = await input.midenWallet.waitForTransaction(requestId);
  if (!confirmed.outputNotes?.some(note => note.id().toString() === deposit.noteId) || !/^0x[\da-f]{64}$/i.test(confirmed.txHash)) {
    throw new Error("The wallet response could not confirm this deposit. Keep the receipt and check its status.");
  }
  const funded = { ...operation, submission: "confirmed" as const };
  context.update({ sourceTxHash: confirmed.txHash, midenTxId: confirmed.txHash, near: funded });
  await notifyDeposit(context, funded, confirmed.txHash);
}

/** Once a wallet attempt is durably claimed, only tracking may resume it. */
export async function submitNearTransfer(context: SubmissionContext) {
  const { input, route } = context;
  if (route.provider !== "near") throw new Error("Invalid NEAR transfer route.");
  if (input.quote?.kind !== "near") throw new Error("Review an executable NEAR quote before sending.");
  const binding = nearInput({ route, ...input });
  const quote = verifyNearQuote(input.quote.authorization, binding, false);
  validateNearDeposit(quote);
  const id = `act-near-${quoteHash(quote as unknown as QuoteResponse)}`;
  if (!globalThis.navigator?.locks) throw new Error("Browser locks are required before sending.");
  await navigator.locks.request(id, async () => {
    const existing = await context.findActivity(id);
    if (existing?.near && existing.near.submission !== "prepared") {
      context.record(existing);
      return;
    }
    return route.mode === "receive"
      ? submitExternalDeposit(context, binding, quote, id)
      : submitMidenDeposit(context, binding, quote, id);
  });
}
