import { createPublicClient, parseAbi, parseEventLogs, type Hex, type TransactionReceipt } from "viem";
import { evmServerTransport } from "../../evm/rpc.server";
import { findTransactionReceipt } from "../../evm/transaction-receipt";
import { cctpConfig, cctpSource, type CctpNetwork } from "./cctp-config";
import { arcConfig } from "./config";
import { parseCctpBurn, type CctpBurn } from "./cctp-message";
import { findCctpForwarding, type CctpForwarding } from "./cctp-forwarding.server";
import { CircleApiError } from "./circle-error";
import { reportCircleFailure } from "./circle-http.server";
import { readArcDepositStatus, UnsupportedArcDepositError } from "./arc-status-server";
import type { ArcStatusResponse } from "./status";

const messageAbi = parseAbi(["event MessageSent(bytes message)"]);
const executorAbi = parseAbi(["event Executed(bytes4 indexed transport,uint8 version,address indexed handler,address indexed token,uint256 amount,bytes32 nonce)"]);

export type CctpStatusResponse = ArcStatusResponse & {
  source?: { sender: string; recipient: string; amount: string };
  arcTxHash?: Hex;
  forwarding?: boolean;
};

function readSourceBurn(receipt: TransactionReceipt, network: CctpNetwork, deploymentId?: string): CctpBurn {
  const { messageTransmitter } = cctpConfig(deploymentId, network);
  const messages = parseEventLogs({
    abi: messageAbi,
    logs: receipt.logs.filter(log => log.address.toLowerCase() === messageTransmitter.toLowerCase()),
  });
  if (messages.length !== 1) throw new Error("Expected one Circle burn message.");
  return parseCctpBurn(messages[0].args.message, network, deploymentId);
}

function assertForwardedExecution(receipt: TransactionReceipt, forwarding: CctpForwarding, deploymentId?: string): void {
  const arc = arcConfig(deploymentId);
  const cctp = cctpConfig(deploymentId);
  const executions = parseEventLogs({
    abi: executorAbi,
    logs: receipt.logs.filter(log => log.address.toLowerCase() === cctp.executor.toLowerCase()),
  });
  const matchesBurn = executions.some(({ args }) => {
    if (args.version !== 1 || args.nonce.toLowerCase() !== forwarding.message.nonce) return false;
    return args.handler.toLowerCase() === cctp.handler.toLowerCase() &&
      args.token.toLowerCase() === arc.usdc.toLowerCase() && args.amount === forwarding.message.transfer.amount;
  });
  if (receipt.status !== "success" || !matchesBurn) {
    throw new CircleApiError("binding_mismatch", "Circle forwarding transaction does not match the source transfer.");
  }
}

function assertForwardedDeposit(deposit: ArcStatusResponse["deposit"], burn: CctpBurn, deploymentId?: string): void {
  if (!deposit) throw new CircleApiError("binding_mismatch", "Forwarded Miden deposit could not be verified.");
  const { handler } = cctpConfig(deploymentId);
  if (deposit.amount !== burn.deposit.amount || deposit.recipient !== burn.deposit.recipient ||
      deposit.sender.toLowerCase() !== handler.toLowerCase()) {
    throw new CircleApiError("binding_mismatch", "The forwarded deposit does not match the source transfer.");
  }
}

async function readForwardedDeposit(
  forwarding: CctpForwarding, burn: CctpBurn, pending: CctpStatusResponse, deploymentId?: string,
): Promise<CctpStatusResponse> {
  const arc = arcConfig(deploymentId);
  const client = createPublicClient({ chain: arc.chain, transport: evmServerTransport(arc.network) });
  const receipt = await findTransactionReceipt(client, forwarding.transactionHash);
  if (!receipt) return pending;
  assertForwardedExecution(receipt, forwarding, deploymentId);
  const status = await readArcDepositStatus(client, receipt, deploymentId);
  assertForwardedDeposit(status.deposit, burn, deploymentId);
  return { ...status, source: burn.deposit, arcTxHash: forwarding.transactionHash, sourceTxAt: pending.sourceTxAt, forwarding: false };
}

export async function getCctpStatus(network: CctpNetwork, hash: Hex, deploymentId?: string): Promise<CctpStatusResponse> {
  const source = cctpSource(network, deploymentId);
  const cctp = cctpConfig(deploymentId, network);
  const client = createPublicClient({ chain: source.chain, transport: evmServerTransport(network) });
  const receipt = await findTransactionReceipt(client, hash);
  if (!receipt) return { status: "submitted" };
  if (receipt.status === "reverted") return { status: "reverted" };
  const burn = readSourceBurn(receipt, network, deploymentId);
  const pending: CctpStatusResponse = {
    status: "submitted", source: burn.deposit, forwarding: true,
  };
  try {
    const block = await client.getBlock({ blockHash: receipt.blockHash });
    pending.sourceTxAt = Number(block.timestamp) * 1_000;
    const forwarding = await findCctpForwarding(cctp.api, hash, burn.message);
    if (!forwarding) return pending;
    return await readForwardedDeposit(forwarding, burn, pending, deploymentId);
  } catch (error) {
    if (error instanceof CircleApiError && error.reason === "binding_mismatch") throw error;
    if (error instanceof UnsupportedArcDepositError) throw error;
    reportCircleFailure("status", error);
    return { ...pending, warning: "Circle forwarding status unavailable. Tracking will retry." };
  }
}
