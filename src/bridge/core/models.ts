import type { SourceTransaction } from "../evm/source-transaction";
import type { ActivityStatus } from "./activity-status";
import type { BridgeRoute } from "./routes";
import type { BridgeEnvironment } from "../../config/environment";

export type BridgeProvider = "agglayer" | "epoch" | "xreserve";
export const flowModes = ["receive", "send"] as const;
export type FlowMode = (typeof flowModes)[number];

export function isFlowMode(value: unknown): value is FlowMode {
  return flowModes.some((mode) => mode === value);
}

export type BridgeActivity = {
  id: string;
  mode: FlowMode;
  provider: BridgeProvider;
  /** Route selected when the transfer was created; demos may omit it. */
  routeId?: string;
  environment?: BridgeEnvironment;
  /** Captured assets and configuration used for recovery independently of the current release. */
  routeSnapshot?: BridgeRoute;
  status: ActivityStatus;
  /** Chain leg that failed; absent on legacy or provider-unspecified failures. */
  failureLeg?: "source" | "destination";
  amount: string;
  asset: string;
  destination?: string;
  bridgeDestinationAddress?: string;
  /** Recipient Miden account id (0x + 30 hex) for a receive.
   * Epoch receives do not have an Agglayer bridge destination. */
  midenAccountHex?: string;
  sourceTxHash?: string;
  /** Actual wallet transaction identity, retained across fee replacements and reloads. */
  sourceTransaction?: SourceTransaction;
  sourceOriginalTxHash?: string;
  destinationTxHash?: string;
  midenTxId?: string;
  claimTxHash?: string;
  depositCount?: string;
  readyForClaim?: boolean;
  sourceNetworkId?: number;
  destinationNetworkId?: number;
  /** Epoch intent nonce — `getIntentStatus(epochSponsor, epochIntentNonce)`. */
  epochIntentNonce?: string;
  /** Epoch sponsor / user address the intent status is keyed on (EVM 0x). */
  epochSponsor?: string;
  /** Circle attestation is separate from inclusion of the recipient's Miden note. */
  xreserveStatus?: "submitted" | "confirmed" | "attested" | "delivered" | "reverted" | "cancelled" | "replaced";
  xreserveNoteId?: string;
  xreserveBurnStatus?: "pending" | "consuming" | "confirmed" | "discarded";
  xreserveWalletRequestId?: string;
  xreserveWithdrawalFeeEstimate?: string;
  xreserveWithdrawalReceivedEstimate?: string;
  xreserveArcTxHash?: string;
  /** Circle forwarding fee in source USDC minor units, paid separately. */
  xreserveFee?: string;
  xreserveForwarding?: boolean;
  xreserveMidenBlock?: number;
  /** Quoted output decimal amount (e.g. "99.17") in the route's destination
   * token. Legacy activities use `asset` for both sides. */
  receivedAmount?: string;
  /** Owner tags for per-account filtering of account-derived history. */
  evmAddress?: string;
  midenAccount?: string;
  /** Source-relative ordering hint (higher = newer) for merged remote history. */
  sortKey?: number;
  updatedAt: number;
  /** When each leg's transaction was first recorded (epoch ms). A bridge transfer
   * is two transactions — one per chain — so the receipt times them separately;
   * `destinationTxAt` stays undefined until that leg's tx exists. */
  sourceTxAt?: number;
  destinationTxAt?: number;
};

/** Persisted activity data shared by execution, tracking and rendering. */
export type Activity = BridgeActivity & {
  summary: string;
  eta: string;
  txHash: string;
};

/** Decimal quote amounts without symbols or locale formatting. */
export type BridgeQuote = {
  asset: string;
  expectedReceived: string;
  minReceived: string;
};
