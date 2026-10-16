import { evmNetworks } from "../../config/evm-networks";
import type { BridgeAsset, BridgeNetwork } from "../../bridge/core/assets";
import { activityRoute, type BridgeRoute } from "../../bridge/core/routes";
import { SEPOLIA_NETWORK } from "../../config/sepolia";
import { arcTestnet } from "../../config/arc";
import { type ActivityStatus } from "../../bridge/core/activity-status";
import type { BridgeActivity, BridgeQuote, FlowMode } from "../../bridge/core/models";
import {
  createActivity as createBridgeActivity,
  deriveTransferAction,
  type TransferAction,
  type TransferInputs,
} from "../../bridge/core/rules";

import { activityState } from "../../bridge/activity";
import { bridgeProviders, directionFor } from "../../bridge/providers/registry";
import type { FeePolicy } from "../../bridge/core/provider";
import type { Activity } from "../../bridge/core/models";
export type { Activity } from "../../bridge/core/models";

export type Quote = BridgeQuote & {
  fees: FeePolicy;
  eta: string;
  networkFee: string;
  bridgeFee: string;
  warning: string;
};

export const modes: Record<
  FlowMode,
  {
    label: string;
    from: string;
    to: string;
  }
> = {
  receive: {
    label: "Receive",
    from: "Sepolia",
    to: "Miden",
  },
  send: {
    label: "Send",
    from: "Miden",
    to: "Sepolia",
  },
};

export const explorerUrls = {
  sepolia: SEPOLIA_NETWORK.explorerUrl,
  arc: arcTestnet.blockExplorers.default.url,
  miden: "https://testnet.midenscan.com",
};

export const networkLabels: Record<BridgeNetwork, string> = {
  sepolia: "Sepolia",
  "arc-testnet": "Arc Testnet",
  "base-sepolia": "Base Sepolia",
  "arbitrum-sepolia": "Arbitrum Sepolia",
  "miden-testnet": "Miden",
};

export const tokenNames: Record<string, string> = { USDC: "USD Coin", USDCx: "USDC-backed token", ETH: "Ether" };

export function sourceAssetLabel(asset: BridgeAsset): string {
  return asset.network === "miden-testnet" && asset.symbol === "ETH" ? "Miden ETH" : asset.symbol;
}

export function quoteFor(route: BridgeRoute, amount: string): Quote {
  return quoteFromPolicy(directionFor(route).fees(route), amount, route.destination.symbol);
}

export function destinationAssetSymbol(activity: Activity): string {
  return activityRoute(activity)?.destination.symbol ?? activity.asset;
}

export function quoteForActivity(activity: Activity): Quote {
  const route = activityRoute(activity);
  const quote = quoteFromPolicy(directionFor(activity).fees(route), activity.amount, route?.destination.symbol ?? activity.asset);
  const received = directionFor(activity).activityDetails(activity).received;
  return received ? { ...quote, expectedReceived: received } : quote;
}

export function providerFee(fees: FeePolicy, amount: string, sourceSymbol: string, destinationSymbol: string) {
  const symbol = fees.charging === "deducted" ? destinationSymbol : sourceSymbol;
  return { label: fees.label, value: `${amount} ${symbol}${fees.estimated ? " (estimated)" : ""}` };
}

function quoteFromPolicy(fees: FeePolicy, amount: string, asset: string): Quote {
  const value = /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount.trim()) ? amount.trim() : "0";
  return {
    ...fees, fees, asset,
    expectedReceived: fees.output === "exact" ? value : "—",
    minReceived: fees.output === "exact" ? value : "Not quoted",
  };
}

export interface CtaState {
  action: TransferAction;
  label: string;
  disabled: boolean;
  opensReview: boolean;
}

export interface CtaInputs extends TransferInputs {
  mode: FlowMode;
  sourceTokenSymbol: string;
  submitPhase: string;
  evmNetworkLabel?: string;
}

/** Add button copy and interaction state to the core transfer decision. */
export function deriveCtaState(input: CtaInputs): CtaState {
  const action = deriveTransferAction(input);
  const labels: Record<TransferAction, string> = {
    submitting: input.submitPhase || "Preparing…",
    "enter-amount": "Enter amount",
    "connect-source": input.mode === "receive" ? `Connect ${input.evmNetworkLabel ?? "Sepolia"} wallet` : "Connect Bread wallet",
    "connect-destination": input.mode === "receive" ? "Connect Bread wallet" : `Connect ${input.evmNetworkLabel ?? "Sepolia"} wallet`,
    insufficient: `Not enough ${input.sourceTokenSymbol}`,
    "quote-loading": "Fetching quote…",
    review: input.mode === "receive" ? "Review receive" : "Review send",
  };
  return {
    action,
    label: labels[action],
    disabled: action !== "connect-source" && action !== "connect-destination" && action !== "review",
    opensReview: action === "review",
  };
}

export function statusLabel(status: ActivityStatus, activity?: Activity) {
  if (activity && directionFor(activity).tracking === "manual") return activityState(activity).headline;
  const labels: Record<ActivityStatus, string> = {
    signature: "Needs signature",
    source_finality: "Confirming",
    message_observed: "Message observed",
    claim_available: "Claim funds",
    claim_submitted: "Claim submitted",
    failed: "Needs recovery",
    complete: "Complete",
  };
  return labels[status];
}

export function statusTone(status: ActivityStatus, activity?: Activity) {
  if (activity && directionFor(activity).tracking === "manual" && status !== "complete" && status !== "failed") return "";
  if (status === "complete") return "success";
  if (status === "failed") return "danger";
  if (status === "claim_available") return "warning";
  return "active";
}

export function createActivity(
  route: BridgeRoute,
  amount: string,
  overrides: Partial<Activity> = {},
): Activity {
  const { mode } = route;
  const activity = createBridgeActivity(route, amount);
  const destination = networkLabels[route.destination.network];
  return {
    ...activity,
    summary: mode === "receive"
      ? `Receive ${activity.amount} ${route.destination.symbol} on ${destination}`
      : `Send ${activity.amount} ${activity.asset} to ${destination}`,
    eta: directionFor(route).fees(route).eta,
    txHash: "0xpending",
    ...overrides,
  };
}

// Only a full, real hash makes a valid `/tx/` deep link. The `txHash` field is
// stored abbreviated (shortAddress) for display and "0xpending" before a tx
// exists — both produce broken explorer URLs, so they must never feed a link.
function fullHash(hash?: string): string | undefined {
  if (!hash) return undefined;
  if (hash === "0xpending") return undefined;
  if (hash.includes("…") || hash.includes("...")) return undefined;
  // Only a real 32-byte tx hash (0x + 64 hex) makes a valid `/tx/` deep link.
  // Anything else — a wallet-adapter request UUID, a note id — would render a
  // broken explorer page, so it must never feed a link.
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return undefined;
  return hash;
}

export interface ExplorerLink {
  label: string;
  /** Deep link to the actual tx — only set once the tx exists. */
  href?: string;
  /** False until the transaction is created; the UI renders a disabled link. */
  available: boolean;
}

export function sourceExplorer(activity: BridgeActivity): ExplorerLink {
  if (activity.mode === "receive") {
    const tx = fullHash(directionFor(activity).activityDetails(activity).sourceHash);
    const source = activityRoute(activity)?.source;
    const explorer = source && source.kind !== "miden" ? evmNetworks[source.network].blockExplorers.default : evmNetworks.sepolia.blockExplorers.default;
    return {
      label: `View on ${explorer.name}`,
      href: tx ? `${explorer.url}/tx/${tx}` : undefined,
      available: !!tx,
    };
  }
  // Send source = the Miden note tx (Epoch's P2IDE collateral note / Agglayer's
  // B2AGG note). Deep-link it like the Sepolia side does.
  const midenTx = fullHash(directionFor(activity).activityDetails(activity).sourceHash);
  return {
    label: "View on Midenscan",
    href: midenTx ? `${explorerUrls.miden}/tx/${midenTx}` : undefined,
    available: !!midenTx,
  };
}

export function destinationExplorer(activity: BridgeActivity): ExplorerLink {
  if (activity.mode === "receive") {
    // Midenscan's /tx/ page errors on a cold load (it only renders after a
    // manual refresh — its own message says so), so a deep link to the Miden
    // note-creation tx reads as broken. Link to the recipient account page
    // instead: it loads reliably first-try, and its Transactions / Notes tabs
    // surface the delivered note. Available once the bridge has delivered (the
    // note exists on Miden — status complete / claim tx captured).
    const account = activity.midenAccountHex;
    const delivered =
      activity.status === "complete" || !!fullHash(activity.midenTxId);
    return {
      label: "View on Midenscan",
      href: account ? `${explorerUrls.miden}/account/${account}` : undefined,
      available: delivered && !!account,
    };
  }
  // Send destination = the Sepolia fulfillment tx. Disabled until the solver
  // fulfils and the tx hash is captured — never a broken/list URL.
  const sepoliaTx = fullHash(directionFor(activity).activityDetails(activity).destinationHash);
  const destination = activityRoute(activity)?.destination;
  const explorer = destination && destination.kind !== "miden" ? evmNetworks[destination.network].blockExplorers.default : evmNetworks.sepolia.blockExplorers.default;
  return {
    label: `View on ${explorer.name}`,
    href: sepoliaTx ? `${explorer.url}/tx/${sepoliaTx}` : undefined,
    available: !!sepoliaTx,
  };
}

/**
 * A support-safe snapshot of one activity for a "copy diagnostics" control:
 * local id, route, direction, status, timestamps, the addresses and known tx
 * hashes involved, and the last monitor error. Deliberately excludes anything
 * secret — the Activity model never holds private keys or wallet secrets, only
 * public addresses and on-chain hashes — so the whole object is safe to paste
 * into a support thread.
 */
export function buildDiagnostics(
  activity: Activity,
  extra: { monitorError?: string; lastCheckedAt?: number } = {},
): Record<string, unknown> {
  const prune = <T extends Record<string, unknown>>(obj: T) =>
    Object.fromEntries(
      Object.entries(obj).filter(([, value]) => value !== undefined && value !== ""),
    );
  return {
    tool: "miden-bridge-portal",
    activityId: activity.id,
    route: bridgeProviders[activity.provider].label,
    provider: activity.provider,
    direction: activity.mode,
    status: activity.status,
    statusLabel: statusLabel(activity.status),
    eta: activity.eta,
    amount: `${activity.amount} ${activity.asset}`,
    timestamps: prune({
      updatedAt: activity.updatedAt
        ? new Date(activity.updatedAt).toISOString()
        : undefined,
      lastCheckedAt: extra.lastCheckedAt
        ? new Date(extra.lastCheckedAt).toISOString()
        : undefined,
      capturedAt: new Date().toISOString(),
    }),
    addresses: prune({
      destination: activity.destination,
      bridgeDestinationAddress: activity.bridgeDestinationAddress,
      midenAccountHex: activity.midenAccountHex,
      epochSponsor: activity.epochSponsor,
      evmAddress: activity.evmAddress,
      midenAccount: activity.midenAccount,
    }),
    transactions: prune({
      sourceTxHash: activity.sourceTxHash,
      destinationTxHash: activity.destinationTxHash,
      midenTxId: activity.midenTxId,
      claimTxHash: activity.claimTxHash,
      depositCount: activity.depositCount,
      epochIntentNonce: activity.epochIntentNonce,
      sourceOriginalTxHash: activity.sourceOriginalTxHash,
      sourceTransaction: activity.sourceTransaction,
      xreserveStatus: activity.xreserveStatus,
      xreserveBurnStatus: activity.xreserveBurnStatus,
      xreserveWalletRequestId: activity.xreserveWalletRequestId,
      xreserveNoteId: activity.xreserveNoteId,
      xreserveArcTxHash: activity.xreserveArcTxHash,
      xreserveFee: activity.xreserveFee,
      xreserveForwarding: activity.xreserveForwarding,
      xreserveMidenBlock: activity.xreserveMidenBlock,
    }),
    lastMonitorError: extra.monitorError || undefined,
  };
}
