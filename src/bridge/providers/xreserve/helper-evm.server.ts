import "server-only";
import { z } from "zod";
import { encodeFunctionData, TransactionNotFoundError, TransactionReceiptNotFoundError } from "viem";
import { configKey, currentBridgeConfig } from "../../../config/bridge-config";
import { assertHelperConfig } from "../../../config/cctp-helper";
import { evmHelperServer } from "../../../config/cctp-evm-helper.server";
import { evmManualRequestSchema, evmManualAuthorizationSchema, evmBundleSchema, type EvmManualAuthorization, type EvmObservation } from "./helper-evm-types";
import { assertEmbeddedRecipient, assertManualAmounts } from "./helper-hook";
import { assertManualDestination, helperAbi } from "./helper-preflight.server";
import { assertEvmSourcePolicy, evmStandardFee } from "./helper-evm-policy.server";
import { readEvmHelperSource } from "./helper-evm-source.server";
import { validateHelperAttestation } from "./helper-attestation.server";
import { boundedText } from "../../solana/rpc";
import { HELPER_MAX, MANUAL_PENDING } from "./helper-types";
import { bytes32 } from "../../../config/cctp-helper";
export async function quoteEvmHelper(value: unknown) {
  const input = evmManualRequestSchema.parse(value), amount = BigInt(input.grossAmount);
  assertEmbeddedRecipient(input.midenRecipient);
  if (amount <= 0n || amount > HELPER_MAX) throw new Error("Amount out of range.");
  const { deployment, server } = evmHelperServer(input.deploymentId, true);
  assertHelperConfig(deployment, currentBridgeConfig(deployment.environment));
  const [, sourceMinimum] = await Promise.all([
    assertManualDestination(deployment, server, input.midenRecipient, { grossAmount: amount, netAmount: amount, phase: "source-admission" }),
    assertEvmSourcePolicy(deployment, server, input.sourceAccount, amount),
  ]);
  const maxCctpFee = await evmStandardFee(deployment, server, amount, sourceMinimum);
  const quote = { ...input, runtime: "evm" as const, execution: "manual" as const,
    maxCctpFee: maxCctpFee.toString(), minimumNet: (amount - maxCctpFee).toString(), checkedAt: new Date().toISOString() };
  assertManualAmounts(quote);
  return quote;
}
const irisSchema = z.object({ sourceTxHash: bytes32, messages: z.array(z.object({ status: z.string(),
  message: z.string().max(1000).nullable().optional(), attestation: z.string().max(26_002).nullable().optional(),
  eventNonce: z.string().optional(), cctpVersion: z.number().optional(),
})).max(50) });
export async function observeEvmHelper(value: unknown): Promise<EvmObservation> {
  const { authorization: auth, hash } = z.object({ authorization: evmManualAuthorizationSchema, hash: bytes32 }).strict().parse(value);
  const { deployment, server } = evmHelperServer(auth.deploymentId);
  if (configKey(auth.deployment) !== configKey(deployment)) throw new Error("Historical source identity changed.");
  try {
    const observed = await readEvmHelperSource(auth, hash, server);
    if (observed.state !== "source_finalized") return observed;
    return await readEvmAttestation(auth, observed.source, server);
  } catch (error) {
    if (error instanceof TransactionNotFoundError || error instanceof TransactionReceiptNotFoundError) return { state: "pending" };
    return { state: "needs_attention", reason: "Source history, finality or attestation validation is unavailable. Do not burn again." };
  }
}
async function readEvmAttestation(auth: EvmManualAuthorization, source: z.infer<typeof evmBundleSchema>["source"], server: ReturnType<typeof evmHelperServer>["server"]): Promise<EvmObservation> {
  const response = await fetch(`${server.irisApi}/v2/messages/${auth.deployment.source.domain}?transactionHash=${source.sourceTransaction}`,
    { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return { state: "source_finalized", source };
  if (!response.ok) throw new Error("Circle unavailable.");
  const iris = irisSchema.parse(JSON.parse(await boundedText(response, 1_000_000)));
  if (iris.sourceTxHash !== source.sourceTransaction) throw new Error("Circle source mismatch.");
  const rows = iris.messages.filter(row => row.status === "complete");
  if (!rows.length) return { state: "source_finalized", source };
  if (rows.length !== 1) throw new Error("Ambiguous Circle messages.");
  const row = rows[0], message = evmBundleSchema.shape.message.parse(row.message), attestation = evmBundleSchema.shape.attestation.parse(row.attestation);
  const { actual, net } = await validateHelperAttestation(source, message, attestation, auth.deployment, server, row);
  return { state: "ready", bundle: evmBundleSchema.parse({ schemaVersion: 1, execution: "manual", deployment: auth.deployment, source,
    cctpNonce: actual.nonce, message, attestation, maxCctpFee: auth.maxCctpFee, feeExecuted: actual.feeExecuted.toString(), netAmount: net.toString(),
    checkedAt: new Date().toISOString(), simulationCaller: server.simulationCaller,
    call: { to: auth.deployment.helper.address, value: "0", function: "receiveAndDeposit(bytes,bytes)",
      data: encodeFunctionData({ abi: helperAbi, functionName: "receiveAndDeposit", args: [message, attestation] }) },
    notice: MANUAL_PENDING, revalidation: "The executor must independently revalidate and simulate this call before spending Arc gas." }) };
}
