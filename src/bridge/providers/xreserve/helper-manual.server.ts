import "server-only";
import { z } from "zod";
import { encodeFunctionData } from "viem";
import { assertHelperConfig, solanaSignature } from "../../../config/cctp-helper";
import { helperServer, type HelperServer } from "../../../config/cctp-helper.server";
import { currentBridgeConfig } from "../../../config/bridge-config";
import { assertEmbeddedRecipient, assertManualAmounts, requiredManualFee } from "./helper-hook";
import { HELPER_MAX, MANUAL_PENDING, manualBundleSchema, manualQuoteRequestSchema, type ManualObservation, type ManualSourceEvidence } from "./helper-types";
import { assertManualDestination, helperAbi, preflightAbi, readManualSourcePolicy, readStandardFee } from "./helper-preflight.server";
import { readFinalizedManualSource } from "../../solana/source-transaction";
import { boundedText } from "../../solana/rpc";
import { decodeCctpMessage, matchAttestedMessage } from "./cctp-message";

export async function quoteManualHelper(value: unknown) {
  const input = manualQuoteRequestSchema.parse(value);
  try { assertEmbeddedRecipient(input.midenRecipient); } catch { throw new ManualApiError(422, "invalid_recipient"); }
  const amount = BigInt(input.grossAmount);
  if (amount <= 0n || amount > HELPER_MAX) throw new ManualApiError(422, "amount_out_of_range");
  const { deployment, server } = helperServer(input.deploymentId, true);
  assertHelperConfig(deployment, currentBridgeConfig(deployment.environment));
  const [, minFee, minimumFee] = await Promise.all([
    assertManualDestination(deployment, server, input.midenRecipient, { grossAmount: amount, netAmount: amount, phase: "source-admission" }),
    readManualSourcePolicy(deployment, server, input.sourceAccount, amount), readStandardFee(server),
  ]);
  const cap = requiredManualFee(amount, minimumFee, minFee);
  const quote = { ...input, execution: "manual" as const, maxCctpFee: cap.toString(), minimumNet: (amount - cap).toString(), checkedAt: new Date().toISOString() };
  assertManualAmounts(quote);
  return quote;
}

const irisSchema = z.object({ sourceTxHash: solanaSignature, messages: z.array(z.object({ status: z.string(),
  message: z.string().max(1000).nullable().optional(), attestation: z.string().max(26_002).nullable().optional(),
  eventNonce: z.string().optional(), cctpVersion: z.number().optional(),
})).max(50) });

export async function validateManualHelperAttestation(source: ManualSourceEvidence, value: unknown, deployment: ReturnType<typeof helperServer>["deployment"], server: HelperServer) {
  const row = completedIrisAttestation(source, value);
  if (!row) return null;
  const message = manualBundleSchema.shape.message.parse(row.message), attestation = manualBundleSchema.shape.attestation.parse(row.attestation);
  const actual = decodeCctpMessage(message), original = decodeCctpMessage(source.message);
  assertStandardAttestationTerms(original, actual);
  if (row.eventNonce !== undefined && row.eventNonce.toLowerCase() !== actual.nonce) throw new Error("Circle nonce mismatch.");
  if (row.cctpVersion !== undefined && row.cctpVersion !== 2) throw new Error("Circle version mismatch.");
  const net = actual.transfer.amount - actual.feeExecuted;
  if (net <= 0n || net > HELPER_MAX) throw new Error("Invalid attested amount.");
  const client = await assertManualDestination(deployment, server, source.midenRecipient, { grossAmount: actual.transfer.amount, netAmount: net, phase: "attested" });
  // Read-only authentication: Circle observes the helper as destinationCaller.
  const received = await client.simulateContract({ address: deployment.arc.messageTransmitter.address, abi: preflightAbi,
    functionName: "receiveMessage", args: [message, attestation], account: deployment.helper.address });
  if (received.result !== true) throw new Error("Circle attestation validation failed.");
  // Independent full atomic call simulation uses a documented nonprivileged caller, no signer or funds.
  await client.simulateContract({ address: deployment.helper.address, abi: helperAbi, functionName: "receiveAndDeposit",
    args: [message, attestation], account: server.simulationCaller });
  return manualBundleSchema.parse({ schemaVersion: 1, execution: "manual", deployment, source, cctpNonce: actual.nonce,
    message, attestation, maxCctpFee: source.maxCctpFee, feeExecuted: actual.feeExecuted.toString(), netAmount: net.toString(),
    checkedAt: new Date().toISOString(), simulationCaller: server.simulationCaller,
    call: { to: deployment.helper.address, value: "0", function: "receiveAndDeposit(bytes,bytes)",
      data: encodeFunctionData({ abi: helperAbi, functionName: "receiveAndDeposit", args: [message, attestation] }) },
    notice: MANUAL_PENDING, revalidation: "The executor must independently revalidate and simulate this call before spending Arc gas.",
  });
}

function completedIrisAttestation(source: ManualSourceEvidence, value: unknown) {
  const iris = irisSchema.parse(value);
  if (iris.sourceTxHash !== source.sourceTransaction) throw new Error("Circle source identity mismatch.");
  const complete = iris.messages.filter(message => message.status === "complete");
  if (!complete.length) return null;
  if (complete.length !== 1) throw new Error("Ambiguous Circle attestation.");
  return complete[0];
}

function assertStandardAttestationTerms(original: ReturnType<typeof decodeCctpMessage>, actual: ReturnType<typeof decodeCctpMessage>) {
  if (!matchAttestedMessage(original, actual)) throw new Error("Invalid Standard attestation terms.");
  if (actual.transfer.version !== 1 || actual.transfer.burnVersion !== 1) throw new Error("Invalid Standard attestation terms.");
  if (actual.finalityThresholdExecuted < 2000 || actual.expirationBlock !== 0n || actual.feeExecuted > actual.transfer.maxFee)
    throw new Error("Invalid Standard attestation terms.");
  if (BigInt(actual.nonce) === 0n) throw new Error("Invalid Standard attestation terms.");
}

export async function readManualHelperTransfer(id: string, signature: string): Promise<ManualObservation> {
  solanaSignature.parse(signature);
  let registry: ReturnType<typeof helperServer>;
  try { registry = helperServer(id); } catch { return { state: "needs_attention", reason: "historical_deployment_unavailable" }; }
  const { deployment, server } = registry;
  let observation: Awaited<ReturnType<typeof readFinalizedManualSource>>;
  try { observation = await readFinalizedManualSource(deployment, server.solanaRpc, signature); }
  catch { return { state: "needs_attention", reason: "history_unavailable" }; }
  if (observation.state === "pending") return { state: "pending", reason: "source_unconfirmed" };
  if (observation.state === "source_failed") return observation;
  const response = await fetch(`${server.irisApi}/v2/messages/5?transactionHash=${encodeURIComponent(signature)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return { state: "pending", reason: "attestation_pending" };
  if (!response.ok) throw new Error("Circle unavailable.");
  try {
    const bundle = await validateManualHelperAttestation(observation.source, JSON.parse(await boundedText(response, 1_000_000)), deployment, server);
    return bundle ? { state: "ready", bundle } : { state: "pending", reason: "attestation_pending" };
  } catch { return { state: "needs_attention", reason: "attestation_invalid" }; }
}

export class ManualApiError extends Error {
  constructor(readonly status: number, readonly reason: string) { super(reason); }
}

/** Per-process deployment limit plus hard map/body/upstream bounds; not a durable queue. */
const buckets = new Map<string, { start: number; count: number }>();
export function limitManualRequest(key: string) {
  const now = Date.now();
  pruneManualBuckets(now);
  const bucket = buckets.get(key) ?? { start: now, count: 0 };
  if (buckets.size >= 128 && !buckets.has(key) || ++bucket.count > 180) throw new ManualApiError(429, "rate_limited");
  buckets.set(key, bucket);
}
function pruneManualBuckets(now: number) {
  for (const [id, bucket] of buckets) if (now - bucket.start >= 60_000) buckets.delete(id);
}

export async function manualApi(action: () => Promise<unknown>) {
  try { return Response.json(await action(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const { status, reason } = manualFailure(error);
    return Response.json({ reason }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
function manualFailure(error: unknown) {
  if (error instanceof ManualApiError) return { status: error.status, reason: error.reason };
  if (error instanceof z.ZodError) return { status: 400, reason: "invalid_request" };
  return { status: 503, reason: "route_unavailable" };
}

export async function manualRequestJson(request: Request, maximum = 4096) {
  try { return JSON.parse(await boundedText(new Response(request.body), maximum)) as unknown; }
  catch { throw new ManualApiError(400, "invalid_request"); }
}
