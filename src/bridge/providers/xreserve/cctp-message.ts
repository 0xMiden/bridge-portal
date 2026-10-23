import type { BridgeConfig } from "../../../config/bridge-config";
import { pad, size, slice, type Hex } from "viem";
import { arcConfig, ARC_MAX_MIDEN_AMOUNT, cctpConfig, cctpSource, type CctpNetwork } from "./config";
import { decodeCctpDepositHook } from "./cctp-burn";

const MESSAGE_HEADER_BYTES = 148;
const BURN_BODY_BYTES = 228;
const HOOK_OFFSET = MESSAGE_HEADER_BYTES + BURN_BODY_BYTES;

/**
 * Circle's packed MessageV2 header followed by BurnMessageV2 and a forwarding hook.
 * Offsets and widths: https://developers.circle.com/cctp/references/technical-guide#message-format
 * Only this codec deals with byte positions; verification below uses named fields.
 */
export function decodeCctpMessage(message: Hex) {
  if (size(message) <= HOOK_OFFSET) throw new Error("Unsupported Circle burn message: missing forwarding hook.");
  const bytes = message.toLowerCase() as Hex;
  const field = (offset: number, length: number) => slice(bytes, offset, offset + length);
  const uint = (offset: number, length: number) => BigInt(field(offset, length));
  return {
    byteLength: size(message),
    transfer: {
      version: Number(uint(0, 4)),
      sourceDomain: Number(uint(4, 4)),
      destinationDomain: Number(uint(8, 4)),
      sender: field(44, 32),
      recipient: field(76, 32),
      destinationCaller: field(108, 32),
      minFinalityThreshold: Number(uint(140, 4)),
      burnVersion: Number(uint(MESSAGE_HEADER_BYTES, 4)),
      burnToken: field(MESSAGE_HEADER_BYTES + 4, 32),
      mintRecipient: field(MESSAGE_HEADER_BYTES + 36, 32),
      amount: uint(MESSAGE_HEADER_BYTES + 68, 32),
      messageSender: field(MESSAGE_HEADER_BYTES + 100, 32),
      maxFee: uint(MESSAGE_HEADER_BYTES + 132, 32),
      hookData: slice(bytes, HOOK_OFFSET),
    },
    nonce: field(12, 32),
    finalityThresholdExecuted: Number(uint(144, 4)),
    feeExecuted: uint(MESSAGE_HEADER_BYTES + 164, 32),
    expirationBlock: uint(MESSAGE_HEADER_BYTES + 196, 32),
  };
}

export type CctpMessage = ReturnType<typeof decodeCctpMessage>;

/** All source-authored fields remain immutable when Circle fills attestation fields. */
export function matchAttestedMessage(source: CctpMessage, attested: CctpMessage): boolean {
  const actual: Record<string, unknown> = attested.transfer;
  return Object.entries(source.transfer).every(([field, expected]) => actual[field] === expected);
}

/** Accept only this deployment's source token, forwarding executor, and deposit hook. */
export function parseCctpBurn(raw: Hex, network: CctpNetwork, recovery?: BridgeConfig) {
  const message = decodeCctpMessage(raw);
  const { transfer } = message;
  const source = cctpSource(network, recovery);
  const arc = arcConfig(recovery);
  const cctp = cctpConfig(recovery, network);
  if (transfer.version !== 1) throw new Error("Unsupported Circle burn message: message version.");
  if (transfer.sourceDomain !== source.domain || transfer.destinationDomain !== arc.circleDomain) {
    throw new Error("Unsupported Circle burn message: source or destination domain.");
  }
  if (transfer.sender !== pad(cctp.tokenMessenger).toLowerCase() ||
      transfer.destinationCaller !== pad(cctp.executor).toLowerCase()) {
    throw new Error("Unsupported Circle burn message: messenger or forwarding caller.");
  }
  if (transfer.burnToken !== pad(source.asset.address).toLowerCase() ||
      transfer.mintRecipient !== pad(cctp.executor).toLowerCase()) {
    throw new Error("Unsupported Circle burn message: burn token or mint recipient.");
  }
  if (transfer.amount <= 0n || transfer.amount > ARC_MAX_MIDEN_AMOUNT) throw new Error("Unsupported burn amount.");
  const deposit = { ...decodeCctpDepositHook(transfer.hookData, recovery), amount: transfer.amount.toString() };
  return { message, deposit };
}

export type CctpBurn = ReturnType<typeof parseCctpBurn>;
