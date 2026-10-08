import { createPublicClient, pad, parseAbi, parseEventLogs, slice, size, type Hex } from "viem";
import { CCTP, cctpSources, type CctpNetwork } from "./cctp-config";
import { ARC, arcTestnet, ARC_MAX_MIDEN_AMOUNT } from "./config";
import { evmServerTransport } from "../../evm/rpc.server";
import { decodeCctpDepositHook } from "./cctp-hook";
import type { ArcStatusResponse } from "./status";
import { getArcDepositStatus } from "./arc-status-server";

const messageAbi = parseAbi(["event MessageSent(bytes message)"]);
const executorAbi = parseAbi(["event Executed(bytes4 indexed transport,uint8 version,address indexed handler,address indexed token,uint256 amount,bytes32 nonce)"]);
export type CctpStatusResponse = ArcStatusResponse & {
  source?: { sender: string; recipient: string; amount: string };
  arcTxHash?: Hex;
  forwarding?: boolean;
};

export async function getCctpStatus(network: CctpNetwork, hash: Hex): Promise<CctpStatusResponse> {
  const source = cctpSources[network];
  const client = createPublicClient({ chain: source.chain, transport: evmServerTransport(network) });
  const receipt = await client.getTransactionReceipt({ hash }).catch((error: Error) => {
    if (error.name === "TransactionReceiptNotFoundError") return null;
    throw error;
  });
  if (!receipt) return { status: "submitted" };
  if (receipt.status === "reverted") return { status: "reverted" };
  const messages = parseEventLogs({ abi: messageAbi, logs: receipt.logs.filter((log) => log.address.toLowerCase() === CCTP.messageTransmitter.toLowerCase()) });
  if (messages.length !== 1) throw new Error("Expected one Circle burn message.");
  const message = messages[0].args.message;
  // MessageV2's 148-byte header and BurnMessageV2's 228-byte fixed body.
  if (size(message) <= 376 || BigInt(slice(message, 0, 4)) !== 1n ||
      BigInt(slice(message, 4, 8)) !== BigInt(source.domain) || BigInt(slice(message, 8, 12)) !== 26n ||
      slice(message, 44, 76).toLowerCase() !== pad(CCTP.tokenMessenger).toLowerCase() ||
      slice(message, 108, 140).toLowerCase() !== pad(CCTP.executor).toLowerCase() ||
      slice(message, 152, 184).toLowerCase() !== pad(source.asset.address).toLowerCase() ||
      slice(message, 184, 216).toLowerCase() !== pad(CCTP.executor).toLowerCase())
    throw new Error("Unsupported Circle burn message.");
  const amount = BigInt(slice(message, 216, 248));
  if (amount <= 0n || amount > ARC_MAX_MIDEN_AMOUNT) throw new Error("Unsupported burn amount.");
  const deposit = { ...decodeCctpDepositHook(slice(message, 376)), amount: amount.toString() };
  const block = await client.getBlock({ blockHash: receipt.blockHash });
  const pending: CctpStatusResponse = { status: "submitted", source: deposit, sourceTxAt: Number(block.timestamp) * 1000, forwarding: true };
  const response = await fetch(`${CCTP.api}/v2/messages/${source.domain}?transactionHash=${hash}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (response.status === 404) return pending;
  if (!response.ok) return { ...pending, warning: "Circle forwarding status unavailable. Tracking will retry." };
  const body = await response.json();
  const forwarded = (Array.isArray(body.messages) ? body.messages : []).find((entry: { message?: string }) => {
    const attested = entry.message;
    if (!attested || !/^0x(?:[\da-f]{2})+$/i.test(attested) || size(attested as Hex) !== size(message)) return false;
    // Circle fills nonce, finality, executed fee and expiration at attestation.
    // Every immutable byte must match the source-chain MessageSent log.
    return [[0, 12], [44, 144], [148, 312], [376, size(message)]].every(([start, end]) =>
      slice(attested as Hex, start, end).toLowerCase() === slice(message, start, end).toLowerCase());
  });
  if (!forwarded?.forwardTxHash || !/^0x[\da-f]{64}$/i.test(forwarded.forwardTxHash)) return pending;
  const arcTxHash = forwarded.forwardTxHash as Hex;
  const arc = createPublicClient({ chain: arcTestnet, transport: evmServerTransport("arc-testnet") });
  const arcReceipt = await arc.getTransactionReceipt({ hash: arcTxHash });
  const executions = parseEventLogs({ abi: executorAbi, logs: arcReceipt.logs.filter((log) => log.address.toLowerCase() === CCTP.executor.toLowerCase()) });
  // Bind the intermediate transaction to THIS burn, including its Circle nonce.
  if (arcReceipt.status !== "success" || !executions.some(({ args }) => args.version === 1 &&
      args.nonce.toLowerCase() === slice(forwarded.message as Hex, 12, 44).toLowerCase() &&
      args.handler.toLowerCase() === CCTP.handler.toLowerCase() &&
      args.token.toLowerCase() === ARC.usdc.toLowerCase() && args.amount === amount))
    throw new Error("Circle forwarding transaction does not match the source transfer.");
  const statusResponse = await getArcDepositStatus(arcTxHash);
  if (!statusResponse.ok) throw new Error("Forwarded Miden deposit could not be verified.");
  const status: ArcStatusResponse = await statusResponse.json();
  if (!status.deposit || status.deposit.amount !== deposit.amount || status.deposit.recipient !== deposit.recipient ||
      status.deposit.sender.toLowerCase() !== CCTP.handler.toLowerCase())
    throw new Error("The forwarded deposit does not match the source transfer.");
  return { ...status, source: deposit, arcTxHash, sourceTxAt: pending.sourceTxAt, forwarding: false };
}
