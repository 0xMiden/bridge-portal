import type { ActivityStatus } from "./activity-status";

export type BridgeProvider = "near-intents" | "agglayer" | "epoch";
export type FlowMode = "receive" | "send";

export type BridgeActivity = {
  id: string;
  mode: FlowMode;
  provider: BridgeProvider;
  status: ActivityStatus;
  amount: string;
  asset: string;
  destination?: string;
  bridgeDestinationAddress?: string;
  /** Recipient Miden account id (0x + 30 hex) for a receive.
   * Epoch receives do not have an Agglayer bridge destination. */
  midenAccountHex?: string;
  sourceTxHash?: string;
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
  /** Quoted output decimal amount (e.g. "99.17"); the symbol is in `asset`. */
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

/** Decimal quote amounts without symbols or locale formatting. */
export type BridgeQuote = {
  asset: string;
  expectedReceived: string;
  minReceived: string;
};
