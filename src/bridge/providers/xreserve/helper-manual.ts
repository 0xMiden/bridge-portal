import { Buffer } from "buffer";
import { PublicKey, Transaction } from "@solana/web3.js";
import { encodeFunctionData, formatUnits, pad, toHex } from "viem";
import { assertHelperConfig, getHelperDeployment, type HelperDeployment } from "../../../config/cctp-helper";
import { assertPhantomSelection, type PhantomSelection } from "../../../wallets/solana/phantom";
import { assertMidenAccountNetwork } from "../../../wallets/miden/network";
import type { QuoteRequest, QuoteResult } from "../../core/quote";
import type { Activity } from "../../core/models";
import type { SubmissionContext } from "../../core/submission";
import type { ActivityObservation } from "../../core/provider";
import { validateMidenRecipient } from "../../miden-address";
import { assertSolanaGenesis, createSolanaConnection } from "../../solana/rpc";
import { arcRecipient, parseArcAmount } from "./deposit-terms";
import { assertManualAmounts, encodeHelperHook } from "./helper-hook";
import { helperAbi } from "./helper-abi";
import { decodeCctpMessage, matchAttestedMessage } from "./cctp-message";
import { prepareHelperSolana, validateHelperTransactionBytes, verifySignedSolana } from "./helper-solana";
import { manualBundleSchema, manualObservationSchema, manualQuoteSchema, type HelperActivity, type ManualAuthorization, type ManualBundle, type ManualQuote, type ManualObservation } from "./helper-types";
import { withManualSourceLock } from "./helper-submission-lock";
import { activityRoute } from "../../core/routes";
import { configKey } from "../../../config/bridge-config";
import { helperCompletionSchema, type HelperCompletion } from "./helper-completion-types";
import { parseArcDepositIntent } from "./attestation";
import { keccak256 } from "viem";

export function sameHelperDeployment(left: HelperDeployment, right: HelperDeployment) {
  // Admission and refreshed qualification evidence do not change an executed transfer's identity.
  return configKey({ ...left, enabled: false, qualification: null }) === configKey({ ...right, enabled: false, qualification: null });
}
async function manualJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  if (!response.ok) throw new Error("Manual route checks are unavailable. Refresh and review before signing.");
  return await response.json() as unknown;
}
export async function refreshManualQuote(auth: Pick<ManualQuote, "deploymentId" | "sourceDomain" | "sourceAccount" | "grossAmount" | "midenRecipient">, signal?: AbortSignal) {
  return manualQuoteSchema.parse(await manualJson("/api/cctp-helper/manual/quote", { method: "POST", signal,
    headers: { "content-type": "application/json" }, body: JSON.stringify({ deploymentId: auth.deploymentId, sourceDomain: 5,
      sourceAccount: auth.sourceAccount, grossAmount: auth.grossAmount, midenRecipient: auth.midenRecipient }) }));
}
export function assertFreshManualQuote(reviewed: ManualQuote, fresh: ManualQuote) {
  assertManualAmounts(fresh);
  for (const field of ["deploymentId", "sourceDomain", "sourceAccount", "grossAmount", "midenRecipient"] as const)
    if (reviewed[field] !== fresh[field]) throw new Error("The manual quote changed its reviewed transfer terms.");
  const age = Date.now() - Date.parse(fresh.checkedAt);
  if (age < -5000 || age > 30_000 || BigInt(fresh.maxCctpFee) > BigInt(reviewed.maxCctpFee))
    throw new Error("The fee or review changed. Refresh and review again before signing.");
}

export async function quoteManualTransfer(input: QuoteRequest, signal: AbortSignal): Promise<QuoteResult> {
  const deployment = input.route.helperDeployment, source = input.sourceIdentity;
  if (!deployment?.enabled || source?.runtime !== "solana" || source.network !== deployment.source.network) throw new Error("Connect Phantom (Solana).");
  assertHelperConfig(deployment, input.route.recovery);
  assertMidenAccountNetwork(input.midenAccount, deployment.environment);
  await validateMidenRecipient(input.midenAccount);
  const request = { deploymentId: deployment.deploymentId, sourceDomain: 5 as const, sourceAccount: source.address,
    grossAmount: parseArcAmount(input.amount).toString(), midenRecipient: arcRecipient(input.midenAccount) };
  const quote = await refreshManualQuote(request, signal);
  assertFreshManualQuote({ ...quote, ...request }, quote);
  const authorization = { ...quote, deployment, finality: 2000 as const };
  const connection = createSolanaConnection(deployment);
  await assertSolanaGenesis(connection, deployment);
  const cost = await prepareHelperSolana(connection, authorization);
  signal.throwIfAborted();
  assertFreshManualQuote(quote, quote);
  return { kind: "cctp-helper", authorization, sourceFeeLamports: cost.sourceFeeLamports, eventRentLamports: cost.eventRentLamports,
    received: formatUnits(BigInt(quote.minimumNet), 6), fee: formatUnits(BigInt(quote.maxCctpFee), 6),
    validity: { kind: "time", expiresAt: Date.parse(quote.checkedAt) + 30_000 } };
}

type Session = { helper: HelperActivity; prepared?: Awaited<ReturnType<typeof prepareHelperSolana>> };
type SourceConnection = ReturnType<typeof createSolanaConnection>;
type SourceReview = { auth: ManualAuthorization; selection: PhantomSelection; attemptId: string;
  save: NonNullable<SubmissionContext["saveHelperDurably"]> };
const sessions = new Map<string, Session>();

async function assertValidity(connection: SourceConnection, helper: HelperActivity) {
  if (helper.recoveryOnly || !helper.lastValidBlockHeight || !helper.blockhash) throw new Error("Imported recovery cannot sign or resend a source transaction.");
  await assertSolanaGenesis(connection, helper.authorization.deployment);
  const height = await connection.getBlockHeight("confirmed");
  if (!Number.isSafeInteger(height) || height < 0 || BigInt(height) > BigInt(helper.lastValidBlockHeight))
    throw new Error("The saved source transaction validity is unresolved or expired. Check source history; do not burn again.");
}

export async function submitManualHelper(context: SubmissionContext) {
  const review = reviewedSource(context), { auth, save } = review;
  context.phase("Checking manual route and Solana fees…");
  const fresh = await refreshManualQuote(auth);
  assertFreshManualQuote(auth, fresh);
  if (!fresh.arcAnchor) throw new Error("A finalized Arc discovery anchor is required before signing.");
  if (!auth.arcAnchor || BigInt(fresh.arcAnchor.block) < BigInt(auth.arcAnchor.block)) auth.arcAnchor = fresh.arcAnchor;
  const connection = createSolanaConnection(auth.deployment);
  await assertSolanaGenesis(connection, auth.deployment);
  const session = await sourceSession(context, review, connection);
  if (!session.helper.signedBytes) await signSourceSession(context, review, connection, session, fresh);
  save({ ...sourcePatch(context, session), sourceTxHash: session.helper.signature });
  await assertSourceSendWindow(context, review, connection, session);
  context.phase("Sending the saved Solana transaction…");
  session.helper = { ...session.helper, stage: "source_unknown" };
  save({ ...sourcePatch(context, session), sourceTxHash: session.helper.signature });
  await broadcastSavedSource(context, connection, session);
}

function reviewedSource({ input, route, saveHelperDurably }: SubmissionContext): SourceReview {
  const auth = input.quote?.kind === "cctp-helper" ? input.quote.authorization : undefined;
  const selection = input.solanaWallet, attemptId = input.helperAttemptId;
  if (!auth || !selection || !attemptId) throw new Error("Review the manual transfer and connect Phantom (Solana).");
  if (!saveHelperDurably || !route.helperDeployment) throw new Error("Review the manual transfer and connect Phantom (Solana).");
  assertPhantomSelection(selection);
  if (!sameHelperDeployment(getHelperDeployment(auth.deploymentId, true), auth.deployment)) throw new Error("Reviewed manual transfer changed.");
  if (auth.sourceAccount !== selection.address || auth.grossAmount !== parseArcAmount(input.amount).toString() ||
      auth.midenRecipient !== arcRecipient(input.midenAccount)) throw new Error("Reviewed manual transfer changed.");
  assertHelperConfig(auth.deployment, route.recovery);
  return { auth, selection, attemptId, save: saveHelperDurably };
}

async function sourceSession(context: SubmissionContext, review: SourceReview, connection: SourceConnection): Promise<Session> {
  const session = sessions.get(review.attemptId);
  if (!session && context.existingHelper) throw new Error("Recover the saved source attempt. This tab cannot prepare or sign a replacement burn.");
  if (session) { assertSessionReview(session, review.auth); return session; }
  const prepared = await prepareHelperSolana(connection, review.auth);
  const quote = context.input.quote;
  if (quote?.kind !== "cctp-helper") throw new Error("Solana fee or event-account rent increased. Refresh and review again.");
  if (BigInt(prepared.sourceFeeLamports) > BigInt(quote.sourceFeeLamports) || BigInt(prepared.eventRentLamports) > BigInt(quote.eventRentLamports))
    throw new Error("Solana fee or event-account rent increased. Refresh and review again.");
  const created: Session = { prepared, helper: { schemaVersion: 2, execution: "automatic", authorization: review.auth, attemptId: review.attemptId, stage: "signing",
    eventAccount: prepared.eventAccount, scanStartSlot: prepared.scanStartSlot, blockhash: prepared.blockhash,
    lastValidBlockHeight: prepared.lastValidBlockHeight, sourceFeeLamports: prepared.sourceFeeLamports, eventRentLamports: prepared.eventRentLamports } };
  sessions.set(review.attemptId, created);
  return created;
}

function assertSessionReview(session: Session, auth: ManualAuthorization) {
  if (!["signing", "signed"].includes(session.helper.stage)) throw new Error("This source attempt was already submitted. Recover its saved signature; do not burn again.");
  const previous = session.helper.authorization;
  if (JSON.stringify(previous) === JSON.stringify(auth)) return;
  const message = "The existing source attempt has different reviewed terms. Recover it before starting another burn.";
  if (!sameHelperDeployment(previous.deployment, auth.deployment)) throw new Error(message);
  for (const field of ["sourceAccount", "grossAmount", "midenRecipient", "maxCctpFee"] as const)
    if (previous[field] !== auth[field]) throw new Error(message);
}

function sourcePatch(context: SubmissionContext, session: Session): Partial<Activity> {
  const auth = session.helper.authorization, recipient = context.input.midenAccount;
  return { cctpHelper: session.helper, solanaAddress: auth.sourceAccount, midenAccount: recipient,
    destination: recipient, midenAccountHex: `0x${auth.midenRecipient.slice(34, 64)}`, receivedAmount: formatUnits(BigInt(auth.minimumNet), 6) };
}

function assertSourceWallets(context: SubmissionContext, review: SourceReview) {
  assertPhantomSelection(review.selection);
  context.input.assertCurrentWallets?.();
}

async function signSourceSession(context: SubmissionContext, review: SourceReview, connection: SourceConnection, session: Session, fresh: ManualQuote) {
  const prepared = session.prepared;
  if (!prepared) throw new Error("This source attempt needs recovery. No new burn will be signed.");
  await assertValidity(connection, session.helper);
  assertFreshManualQuote(review.auth, fresh);
  assertSourceWallets(context, review);
  review.save(sourcePatch(context, session)); // Acknowledge the attempt before requesting a signature.
  context.phase("Confirm the USDC burn in Phantom (Solana)…");
  const original = prepared.transaction.serializeMessage();
  const signed = await signOnly(review.selection, prepared.transaction);
  assertSourceWallets(context, review);
  const verified = verifySignedSolana(original, signed, review.auth.sourceAccount, session.helper.eventAccount);
  session.helper = { ...session.helper, ...verified, stage: "signed" };
  session.prepared = undefined;
}

async function signOnly(selection: PhantomSelection, transaction: Transaction) {
  try {
    if (typeof selection.provider.signTransaction !== "function") throw new Error("Phantom sign-only is unavailable.");
    return await selection.provider.signTransaction(Transaction.from(transaction.serialize({ requireAllSignatures: false })));
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === -32601) throw new Error("Phantom sign-only is unsupported. Submission is disabled.");
    if (code === 4001) throw new Error("Phantom signing was rejected. No transaction was broadcast.");
    throw new Error("Phantom signing did not return a verified transaction. Nothing was broadcast by this app. Keep the saved attempt and original tab; do not start another burn.");
  }
}

async function assertSourceSendWindow(context: SubmissionContext, review: SourceReview, connection: SourceConnection, session: Session) {
  await assertValidity(connection, session.helper);
  assertSourceWallets(context, review);
  assertFreshManualQuote(review.auth, await refreshManualQuote(review.auth));
  await assertValidity(connection, session.helper);
  assertSourceWallets(context, review);
}

async function broadcastSavedSource(context: SubmissionContext, connection: SourceConnection, session: Session) {
  const { signature, signedBytes } = session.helper;
  try {
    if (!signature || !signedBytes) throw new Error("Signed source packet is unavailable. Recover the saved attempt; do not burn again.");
    const actual = await connection.sendRawTransaction(Buffer.from(signedBytes, "base64"), { skipPreflight: false, maxRetries: 0 });
    if (actual !== signature) throw new Error("Source returned a different signature.");
  } finally {
    context.record({ ...sourcePatch(context, session), sourceTxHash: signature });
  }
}

export function validateBundleForActivity(bundle: ManualBundle, helper: HelperActivity): ManualBundle {
  const value = manualBundleSchema.parse(bundle), auth = helper.authorization;
  assertManualAmounts(auth);
  if (helper.bundle && helper.bundle.message !== value.message) throw new Error("Circle returned a different completed message for this source. Preserve the original evidence.");
  if (value.messageHash && value.messageHash !== keccak256(value.message)) throw new Error("Attested message hash mismatch.");
  if (value.attestationHash && value.attestationHash !== keccak256(value.attestation)) throw new Error("Attestation hash mismatch.");
  assertBundleReview(value, helper);
  const decoded = decodeCctpMessage(value.message), original = decodeCctpMessage(value.source.message);
  assertSourceProtocol(original.transfer);
  assertSourceEndpoints(original.transfer, auth.deployment);
  assertSourceEconomicIntent(original.transfer, auth);
  assertSourceOccurrence(value.source, helper);
  assertAttestedExecution(value, original, decoded, auth);
  const expectedCall = encodeFunctionData({ abi: helperAbi, functionName: "receiveAndDeposit", args: [value.message, value.attestation] });
  if (value.call.to !== auth.deployment.helper.address || value.call.data !== expectedCall) throw new Error("Manual handoff calldata mismatch.");
  return value;
}

function assertBundleReview(value: ManualBundle, helper: HelperActivity) {
  const auth = helper.authorization, source = value.source, message = "Manual handoff does not match the saved review.";
  if (!sameHelperDeployment(value.deployment, auth.deployment) || source.sourceTransaction !== helper.signature || source.eventAccount !== helper.eventAccount)
    throw new Error(message);
  if (source.sourceAccount !== auth.sourceAccount || source.grossAmount !== auth.grossAmount || source.maxCctpFee !== auth.maxCctpFee) throw new Error(message);
  if (value.maxCctpFee !== auth.maxCctpFee || source.midenRecipient !== auth.midenRecipient) throw new Error(message);
}

type SourceTransfer = ReturnType<typeof decodeCctpMessage>["transfer"];
const sourceMismatch = "Manual handoff source bytes do not match the saved review.";

function assertSourceProtocol(transfer: SourceTransfer) {
  if (transfer.version !== 1 || transfer.burnVersion !== 1) throw new Error(sourceMismatch);
  if (transfer.sourceDomain !== 5 || transfer.destinationDomain !== 26 || transfer.minFinalityThreshold !== 2000) throw new Error(sourceMismatch);
}

function assertSourceEndpoints(transfer: SourceTransfer, deployment: HelperDeployment) {
  if (transfer.sender !== toHex(new PublicKey(deployment.source.tokenMessengerProgram).toBytes()) ||
      transfer.recipient !== pad(deployment.arc.tokenMessenger.address)) throw new Error(sourceMismatch);
  if (transfer.destinationCaller !== pad(deployment.helper.address) || transfer.mintRecipient !== pad(deployment.helper.address)) throw new Error(sourceMismatch);
}

function assertSourceEconomicIntent(transfer: SourceTransfer, auth: ManualAuthorization) {
  if (transfer.burnToken !== toHex(new PublicKey(auth.deployment.source.mint).toBytes()) ||
      transfer.messageSender !== toHex(new PublicKey(auth.sourceAccount).toBytes()) || transfer.amount !== BigInt(auth.grossAmount)) throw new Error(sourceMismatch);
  if (transfer.maxFee !== BigInt(auth.maxCctpFee) || transfer.hookData !== encodeHelperHook(auth.midenRecipient)) throw new Error(sourceMismatch);
}

function assertSourceOccurrence(source: ManualBundle["source"], helper: HelperActivity) {
  const parts = source.sourceEventIds[0].split(":"), message = "Manual handoff source occurrence mismatch.";
  if (parts.length !== 4 || parts[0] !== "solana" || parts[1] !== helper.signature) throw new Error(message);
  if (parts.slice(2).some(value => !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) || BigInt(source.slot) < BigInt(helper.scanStartSlot))
    throw new Error(message);
}

export function validateSavedHelperSource(helper: HelperActivity) {
  const source = helper.sourceEvidence, auth = helper.authorization;
  if (!source) return;
  assertManualAmounts(auth);
  if (source.sourceTransaction !== helper.signature || source.eventAccount !== helper.eventAccount) throw new Error("Saved source identity mismatch.");
  const fields = ["sourceAccount", "grossAmount", "maxCctpFee", "midenRecipient"] as const;
  if (fields.some(field => source[field] !== auth[field])) throw new Error("Saved source terms mismatch.");
  const message = decodeCctpMessage(source.message);
  assertSourceProtocol(message.transfer);
  assertSourceEndpoints(message.transfer, auth.deployment);
  assertSourceEconomicIntent(message.transfer, auth);
  assertSourceOccurrence(source, helper);
}

function assertAttestedExecution(value: ManualBundle, original: ReturnType<typeof decodeCctpMessage>, decoded: ReturnType<typeof decodeCctpMessage>, auth: ManualAuthorization) {
  const message = "Manual handoff fee or finality mismatch.";
  if (BigInt(decoded.nonce) === 0n) throw new Error("A completed Circle message requires its assigned nonce.");
  if (!matchAttestedMessage(original, decoded) || decoded.finalityThresholdExecuted < 2000 || decoded.expirationBlock !== 0n) throw new Error(message);
  if (decoded.feeExecuted > BigInt(auth.maxCctpFee)) throw new Error(message);
  if (decoded.feeExecuted.toString() !== value.feeExecuted || (BigInt(auth.grossAmount) - decoded.feeExecuted).toString() !== value.netAmount || value.cctpNonce !== decoded.nonce)
    throw new Error(message);
}

export async function observeManualHelper(activity: Activity, signal: AbortSignal): Promise<ActivityObservation> {
  try { return await observeManualHelperVerified(activity, signal); }
  catch (error) {
    if (signal.aborted || !activity.cctpHelper) throw error;
    return { patch: {}, warning: "Transfer status is temporarily unavailable. Saved progress is retained; do not burn again." };
  }
}
async function observeManualHelperVerified(activity: Activity, signal: AbortSignal) {
  const helper = activity.cctpHelper;
  if (!helper?.signature) return { patch: {}, warning: "This attempt needs its original tab to finish saving/signing. Do not create another burn." };
  const observation = await requestHelperObservation(activity, signal);
  switch (observation.state) {
    case "tracking": return trackingObservation(activity, validateBundleForActivity(observation.bundle, helper), observation.completion, signal);
    case "ready": {
      const bundle = validateBundleForActivity(observation.bundle, helper);
      return { patch: { cctpHelper: { ...helper, stage: "ready" as const, bundle, sourceEvidence: bundle.source, signedBytes: undefined, reason: undefined } } };
    }
    case "source_failed": return failedSourceObservation(helper, observation);
    case "source_verified": return { patch: {} };
    default: return pendingSourceObservation(helper, observation);
  }
}

export async function requestHelperObservation(activity: Activity, signal?: AbortSignal, options: { exportCall?: boolean; arcHash?: `0x${string}` } = {}) {
  const helper = activity.cctpHelper;
  if (!helper?.signature) throw new Error("The original source signature is required.");
  const response = await manualJson("/api/cctp-helper/manual/attestation", { method: "POST", signal, headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 2, deploymentId: helper.authorization.deploymentId, sourceTransaction: helper.signature,
      recovery: activityRoute(activity)?.recovery, anchor: helper.authorization.arcAnchor, scan: helper.completion?.scan,
      ...(helper.completion?.arc ? { arcHash: helper.completion.arc.transactionHash } : {}), ...options }) });
  return manualObservationSchema.parse(response);
}

/** Recheck persisted tuple/nonce bindings before deriving a recipient note. */
export function validateHelperCompletion(activity: Activity, bundle: ManualBundle, completion: HelperCompletion) {
  const helper = activity.cctpHelper;
  if (!helper) throw new Error("Missing saved helper activity.");
  helperCompletionSchema.parse(completion);
  if (helper.completion?.needsAttention && completion.intent) throw new Error("Earlier ambiguous completion evidence needs review before selecting a reserve nonce.");
  validateBundleForActivity(bundle, helper);
  const intent = completion.intent;
  if (!intent) return;
  const parsed = parseArcDepositIntent(intent.payload, activityRoute(activity)?.recovery);
  if (keccak256(intent.payload) !== intent.messageHash) throw new Error("Reserve payload hash mismatch.");
  const fields = ["nonce", "amount", "sender", "recipient", "faucet"] as const;
  if (fields.some(field => parsed[field] !== intent[field])) throw new Error("Reserve payload binding mismatch.");
  if (intent.amount !== bundle.netAmount || intent.sender !== helper.authorization.deployment.helper.address) throw new Error("Reserve principal/depositor mismatch.");
  if (arcRecipient(intent.recipient) !== helper.authorization.midenRecipient || intent.faucet !== helper.authorization.deployment.miden.faucetId)
    throw new Error("Reserve destination mismatch.");
}

async function trackingObservation(activity: Activity, bundle: ManualBundle, completion: HelperCompletion, signal: AbortSignal) {
  const helper = activity.cctpHelper;
  if (!helper) throw new Error("Missing saved helper activity.");
  signal.throwIfAborted();
  if (helper.completion?.needsAttention) return { patch: {}, warning: "This transfer has conflicting completion evidence. Keep its transaction hashes for review; do not burn again." };
  validateHelperCompletion(activity, bundle, completion);
  const updated = { ...helper, schemaVersion: 2 as const, execution: "automatic" as const, stage: completion.stage,
    bundle, sourceEvidence: bundle.source, signedBytes: undefined, completion, reason: completion.warning };
  const patch: Partial<Activity> = { cctpHelper: updated, receivedAmount: formatUnits(BigInt(bundle.netAmount), 6),
    summary: `Receive ${formatUnits(BigInt(bundle.netAmount), 6)} USDCx on Miden`,
    ...(completion.arc ? { xreserveArcTxHash: completion.arc.transactionHash } : {}) };
  if (completion.intent && !completion.needsAttention) return checkHelperDelivery(activity, patch, completion, signal);
  return { patch, warning: completion.warning ?? (completion.catchingUp ? "Checking finalized Arc history in bounded pages. Older imports may take longer." : undefined) };
}

async function checkHelperDelivery(activity: Activity, patch: Partial<Activity>, completion: HelperCompletion, signal: AbortSignal) {
  if (!completion.intent || !patch.cctpHelper) throw new Error("Missing reserve authorization.");
  try {
    const { checkArcDelivery } = await import("./delivery");
    const delivery = await checkArcDelivery(completion.intent, activityRoute(activity)?.recovery);
    signal.throwIfAborted();
    patch.xreserveNoteId = delivery.noteId;
    if (delivery.block !== undefined) {
      patch.xreserveMidenBlock = delivery.block; patch.cctpHelper = { ...patch.cctpHelper, stage: "delivered" };
      patch.destinationTxAt = activity.destinationTxAt ?? Date.now();
    }
    return { patch, warning: completion.warning };
  } catch {
    signal.throwIfAborted();
    return { patch, warning: "Reserve authorization is verified. Exact Miden note lookup will retry." };
  }
}

function failedSourceObservation(helper: HelperActivity, observation: Extract<ManualObservation, { state: "source_failed" }>) {
  if (observation.sourceTransaction !== helper.signature) throw new Error("Wrong failed source transaction.");
  if (helper.sourceEvidence) return { patch: { cctpHelper: { ...helper, stage: "needs_attention" as const, reason: "Source evidence contradicts a previously finalized burn." } } };
  return { patch: { cctpHelper: { ...helper, stage: "source_failed" as const, signedBytes: undefined, failedSlot: observation.slot, reason: observation.error } } };
}

function pendingSourceObservation(helper: HelperActivity, observation: Extract<ManualObservation, { state: "pending" | "needs_attention" }>) {
  if (observation.state === "pending" && observation.source) {
    const verified = { ...helper, sourceEvidence: observation.source, signedBytes: undefined, stage: "source_finalized" as const };
    validateSavedHelperSource(verified);
    return { patch: { cctpHelper: verified } };
  }
  if (helper.bundle || helper.sourceEvidence) return { patch: {}, warning: "Fresh status is unavailable. Last verified progress is retained; export requires current simulation." };
  const stage = observation.state === "needs_attention" ? "needs_attention" as const
    : observation.reason === "attestation_pending" ? "source_finalized" as const : "source_unknown" as const;
  const clearPacket = observation.state === "pending" && observation.reason === "attestation_pending";
  return { patch: { cctpHelper: { ...helper, stage, reason: observation.reason, ...(clearPacket ? { signedBytes: undefined } : {}) } } };
}

/** Recovery only resends the verified saved bytes; this function has no signing path. */
export async function resendManualHelper(activity: Activity, save: (patch: Partial<Activity>) => void) {
  return withManualSourceLock(() => resendManualHelperLocked(activity, save));
}
async function resendManualHelperLocked(activity: Activity, save: (patch: Partial<Activity>) => void) {
  const helper = activity.cctpHelper;
  if (!helper?.signedBytes || !helper.signature || helper.recoveryOnly) throw new Error("There are no saved source bytes to resend. Check source history.");
  const { transaction, authorization } = await validateHelperTransactionBytes(Buffer.from(helper.signedBytes, "base64"), helper.authorization.deployment, true);
  for (const field of ["sourceAccount", "grossAmount", "maxCctpFee", "midenRecipient"] as const)
    if (authorization[field] !== helper.authorization[field]) throw new Error("Saved source transaction does not match the review.");
  const verified = verifySignedSolana(transaction.serializeMessage(), transaction, helper.authorization.sourceAccount, helper.eventAccount);
  if (verified.signature !== helper.signature || transaction.recentBlockhash !== helper.blockhash) throw new Error("Saved source bytes changed.");
  const current = getHelperDeployment(helper.authorization.deploymentId, true);
  if (!sameHelperDeployment(current, helper.authorization.deployment)) throw new Error("Saved deployment is unavailable.");
  const connection = createSolanaConnection(helper.authorization.deployment);
  await assertValidity(connection, helper);
  assertFreshManualQuote(helper.authorization, await refreshManualQuote(helper.authorization));
  await assertValidity(connection, helper);
  save({ cctpHelper: helper });
  const signature = await connection.sendRawTransaction(Buffer.from(helper.signedBytes, "base64"), { skipPreflight: false, maxRetries: 0 });
  if (signature !== helper.signature) throw new Error("Source signature mismatch.");
}
