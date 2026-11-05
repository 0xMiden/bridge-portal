import "server-only";
import type { Hex } from "viem";
import type { HelperIdentity } from "../../../config/cctp-helper";
import type { EvmHelperIdentity } from "../../../config/cctp-evm-helper";
import type { HelperServer } from "../../../config/cctp-helper.server";
import { decodeCctpMessage, matchAttestedMessage } from "./cctp-message";
import { HELPER_MAX } from "./helper-types";
import { assertManualDestination, helperAbi, preflightAbi } from "./helper-preflight.server";

type AttestedSource = { message: Hex; midenRecipient: Hex };
/** Both source adapters authenticate the same Standard message and atomic Arc call. */
export async function validateHelperAttestation(source: AttestedSource, message: Hex, attestation: Hex,
  deployment: HelperIdentity | EvmHelperIdentity, server: Pick<HelperServer, "arcRpc" | "simulationCaller">,
  row: { eventNonce?: string; cctpVersion?: number }) {
  const actual = decodeCctpMessage(message), original = decodeCctpMessage(source.message);
  assertStandardAttestationTerms(original, actual);
  if (row.eventNonce !== undefined && row.eventNonce.toLowerCase() !== actual.nonce) throw new Error("Circle nonce mismatch.");
  if (row.cctpVersion !== undefined && row.cctpVersion !== 2) throw new Error("Circle version mismatch.");
  const net = actual.transfer.amount - actual.feeExecuted;
  if (net <= 0n || net > HELPER_MAX) throw new Error("Invalid attested amount.");
  const client = await assertManualDestination(deployment, server, source.midenRecipient, { grossAmount: actual.transfer.amount, netAmount: net, phase: "attested" });
  const received = await client.simulateContract({ address: deployment.arc.messageTransmitter.address, abi: preflightAbi,
    functionName: "receiveMessage", args: [message, attestation], account: deployment.helper.address });
  if (received.result !== true) throw new Error("Circle attestation validation failed.");
  await client.simulateContract({ address: deployment.helper.address, abi: helperAbi, functionName: "receiveAndDeposit",
    args: [message, attestation], account: server.simulationCaller });
  return { actual, net };
}
function assertStandardAttestationTerms(original: ReturnType<typeof decodeCctpMessage>, actual: ReturnType<typeof decodeCctpMessage>) {
  if (!matchAttestedMessage(original, actual)) throw new Error("Invalid Standard attestation terms.");
  if (actual.transfer.version !== 1 || actual.transfer.burnVersion !== 1) throw new Error("Invalid Standard attestation terms.");
  if (actual.finalityThresholdExecuted < 2000 || actual.expirationBlock !== 0n || actual.feeExecuted > actual.transfer.maxFee)
    throw new Error("Invalid Standard attestation terms.");
  if (BigInt(actual.nonce) === 0n) throw new Error("Invalid Standard attestation terms.");
}
