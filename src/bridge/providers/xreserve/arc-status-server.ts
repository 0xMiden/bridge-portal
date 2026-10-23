import type { BridgeConfig } from "../../../config/bridge-config";
import { z } from "zod";
import { createPublicClient, parseEventLogs, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { evmServerTransport } from "../../evm/rpc.server";
import { findTransactionReceipt } from "../../evm/transaction-receipt";
import { hexDataSchema } from "../../evm/evm-schema";
import { arcConfig, ARC_MAX_MIDEN_AMOUNT, xReserveAbi } from "./config";
import { decodeArcRecipient, parseArcDepositIntent, type ArcDepositIntent } from "./attestation";
import { CircleApiError, parseCirclePayload } from "./circle-response";
import { getCircleJson, reportCircleFailure } from "./circle-http.server";
import type { ArcStatusResponse } from "./status";

const domainSchema = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.int().min(0).max(0xffffffff));
const attestationsSchema = z.object({
  attestations: z.array(z.object({
    remoteDomain: domainSchema,
    attestation: hexDataSchema.refine(value => value.length > 2).nullish(),
    payload: hexDataSchema.nullish(),
  })),
});
type Attestation = z.infer<typeof attestationsSchema>["attestations"][number];
type Deposit = Omit<ArcDepositIntent, "nonce">;
type AttestationResult = { intent?: ArcDepositIntent; warning?: string };

export class UnsupportedArcDepositError extends Error {
  name = "UnsupportedArcDepositError";
}

function decodeDepositAccount(value: string): string {
  try {
    return decodeArcRecipient(value);
  } catch (cause) {
    throw new UnsupportedArcDepositError("This deposit contains an unsupported Miden account.", { cause });
  }
}

/** The xReserve event is the authority for recovery and attestation matching. */
function readDeposit(receipt: TransactionReceipt, recovery?: BridgeConfig) {
  const arc = arcConfig(recovery);
  const events = parseEventLogs({
    abi: xReserveAbi,
    eventName: "DepositedToRemote",
    logs: receipt.logs.filter(log => log.address.toLowerCase() === arc.xReserve.toLowerCase()),
  }).filter(({ args }) => args.remoteDomain === arc.midenDomain && args.localToken.toLowerCase() === arc.usdc.toLowerCase());
  if (events.length !== 1) {
    throw new UnsupportedArcDepositError("This transaction does not contain one supported Miden USDCx deposit.");
  }
  const { args } = events[0];
  if (args.value <= 0n || args.value > ARC_MAX_MIDEN_AMOUNT) {
    throw new UnsupportedArcDepositError("This deposit contains an unsupported amount.");
  }
  if (args.maxFee !== 0n || args.hookData !== "0x") {
    throw new UnsupportedArcDepositError("This deposit contains unsupported fee or hook terms.");
  }
  const faucet = decodeDepositAccount(args.remoteToken);
  if (faucet !== arc.faucetId) {
    throw new UnsupportedArcDepositError("This deposit targets a different faucet.");
  }
  return {
    amount: args.value.toString(),
    recipient: decodeDepositAccount(args.remoteRecipient),
    faucet,
    sender: args.localDepositor.toLowerCase(),
  };
}

function readMatchingIntent(attestation: Attestation, deposit: Deposit, recovery?: BridgeConfig): ArcDepositIntent {
  let intent: ArcDepositIntent;
  try {
    if (!attestation.payload) throw new Error("Missing deposit payload.");
    intent = parseArcDepositIntent(attestation.payload, recovery);
  } catch (cause) {
    throw new CircleApiError("invalid_response", "Circle returned an unsupported deposit payload.", { cause });
  }
  if (intent.amount !== deposit.amount || intent.recipient !== deposit.recipient) {
    throw new CircleApiError("binding_mismatch", "Circle returned a different deposit amount or recipient.");
  }
  if (intent.faucet !== deposit.faucet || intent.sender !== deposit.sender) {
    throw new CircleApiError("binding_mismatch", "Circle returned a different deposit faucet or sender.");
  }
  return intent;
}

function findDepositAttestation(attestations: Attestation[], deposit: Deposit, recovery?: BridgeConfig): AttestationResult {
  const arc = arcConfig(recovery);
  let unreadable = false;
  for (const attestation of attestations) {
    if (attestation.remoteDomain !== arc.midenDomain || !attestation.attestation) continue;
    try {
      return { intent: readMatchingIntent(attestation, deposit, recovery) };
    } catch (error) {
      reportCircleFailure("status", error);
      unreadable = true;
    }
  }
  return unreadable ? { warning: "Circle returned details that do not match this deposit. Tracking will retry." } : {};
}

async function getArcDepositAttestation(hash: Hex, deposit: Deposit, recovery?: BridgeConfig): Promise<AttestationResult> {
  const arc = arcConfig(recovery);
  try {
    const body = await getCircleJson(`${arc.attestationApi}/v1/attestations?txHash=${hash}`);
    if (body === undefined) return {};
    const { attestations } = parseCirclePayload(attestationsSchema, body, "Circle returned invalid deposit attestations.");
    return findDepositAttestation(attestations, deposit, recovery);
  } catch (error) {
    reportCircleFailure("status", error);
    return { warning: "Circle status unavailable. Tracking will retry." };
  }
}

/** Reuse the receipt already verified by the forwarding flow. */
export async function readArcDepositStatus(
  client: Pick<PublicClient, "getBlock">, receipt: TransactionReceipt, recovery?: BridgeConfig,
): Promise<ArcStatusResponse> {
  if (receipt.status === "reverted") return { status: "reverted" };
  const deposit = readDeposit(receipt, recovery);
  const block = await client.getBlock({ blockHash: receipt.blockHash });
  const attestation = await getArcDepositAttestation(receipt.transactionHash, deposit, recovery);
  return {
    status: attestation.intent ? "attested" : "confirmed",
    deposit,
    sourceTxAt: Number(block.timestamp) * 1_000,
    ...attestation,
  };
}

export async function getArcDepositStatus(hash: Hex, recovery?: BridgeConfig): Promise<ArcStatusResponse> {
  const arc = arcConfig(recovery);
  const client = createPublicClient({ chain: arc.chain, transport: evmServerTransport(arc.network) });
  const receipt = await findTransactionReceipt(client, hash);
  return receipt ? readArcDepositStatus(client, receipt, recovery) : { status: "submitted" };
}
