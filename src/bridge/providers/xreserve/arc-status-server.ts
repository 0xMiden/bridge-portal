import { createPublicClient, parseEventLogs, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { evmServerTransport } from "../../evm/rpc.server";
import { findTransactionReceipt } from "../../evm/transaction-receipt";
import { arcConfig, ARC_MAX_MIDEN_AMOUNT, xReserveAbi } from "./config";
import { decodeArcRecipient } from "./attestation";
import { getArcDepositAttestation } from "./arc-status-attestation";
import type { ArcStatusResponse } from "./status";

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
function readDeposit(receipt: TransactionReceipt, deploymentId?: string) {
  const arc = arcConfig(deploymentId);
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

/** Reuse the receipt already verified by the forwarding flow. */
export async function readArcDepositStatus(
  client: Pick<PublicClient, "getBlock">, receipt: TransactionReceipt, deploymentId?: string,
): Promise<ArcStatusResponse> {
  if (receipt.status === "reverted") return { status: "reverted" };
  const deposit = readDeposit(receipt, deploymentId);
  const block = await client.getBlock({ blockHash: receipt.blockHash });
  const attestation = await getArcDepositAttestation(receipt.transactionHash, deposit, deploymentId);
  return {
    status: attestation.intent ? "attested" : "confirmed",
    deposit,
    sourceTxAt: Number(block.timestamp) * 1_000,
    ...attestation,
  };
}

export async function getArcDepositStatus(hash: Hex, deploymentId?: string): Promise<ArcStatusResponse> {
  const arc = arcConfig(deploymentId);
  const client = createPublicClient({ chain: arc.chain, transport: evmServerTransport(arc.network) });
  const receipt = await findTransactionReceipt(client, hash);
  return receipt ? readArcDepositStatus(client, receipt, deploymentId) : { status: "submitted" };
}
