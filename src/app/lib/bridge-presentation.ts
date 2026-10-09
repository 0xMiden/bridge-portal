import { evmNetworks } from "../../config/evm-networks";
import type { BridgeAsset, BridgeNetwork } from "../../bridge/core/assets";
import { activityRoute, type BridgeRoute } from "../../bridge/core/routes";
import { formatUnits } from "viem";
import { SEPOLIA_NETWORK } from "../../config/sepolia";
import { arcTestnet } from "../../config/arc";
import { activitySteps, type ActivityStatus } from "../../bridge/core/activity-status";
import type { BridgeActivity, BridgeProvider, BridgeQuote, FlowMode } from "../../bridge/core/models";
import {
  createActivity as createBridgeActivity,
  deriveTransferAction,
  quoteAmounts,
  type TransferAction,
  type TransferInputs,
} from "../../bridge/core/rules";

/** Persisted activity view; the storage shape stays compatible with older rows. */
export type Activity = BridgeActivity & {
  summary: string;
  eta: string;
  /** Abbreviated hash or pending placeholder used by the application. */
  txHash: string;
};

export type Quote = BridgeQuote & {
  eta: string;
  networkFee: string;
  bridgeFee: string;
  relayerFee: string;
  sourceGas: string;
  destinationGas: string;
  warning: string;
};

/**
 * The comparison metadata surfaced in the route selector so a route can be
 * chosen on its merits (asset, speed, fee model, trust boundary, claim
 * responsibility) without selecting it first. Kept alongside the display copy so
 * the menu and the selected-route summary read from one source of truth.
 */
export type RouteComparison = {
  /** Typical end-to-end ETA. */
  eta: string;
  /** How the route charges (short, comparison-friendly). */
  feeModel: string;
  /** Trust / provider boundary the funds pass through. */
  trust: string;
  /** Destination claim or Miden note-consumption responsibility. */
  claim: string;
  /** Availability status shown as a persistent chip. */
  availability: string;
  /** Short factual differentiator, e.g. "Fastest for USDC". */
  differentiator?: string;
  /** Why a disabled route is unavailable (rendered on the disabled option). */
  unavailableReason?: string;
};

export const providers: Record<
  BridgeProvider,
  {
    label: string;
    badge: string;
    route: string;
    disclosure: string;
    comparison: RouteComparison;
    disabled?: boolean;
  }
> = {
  xreserve: {
    label: "USDCx",
    badge: "Testnet",
    route: "Circle xReserve · USDC to Miden",
    disclosure: "Deposit USDC through Circle xReserve to receive a USDCx note on Miden. Consume the delivered note in Bread. Withdrawals are not available yet.",
    comparison: {
      eta: "Delivery time varies",
      feeModel: "Circle forwarding fee where applicable; origin gas applies",
      trust: "Circle xReserve and Miden relayer",
      claim: "Consume the delivered USDCx note in Bread",
      availability: "Deposits only",
      unavailableReason: "USDCx withdrawals are not available yet",
    },
  },
  "near-intents": {
    label: "NEAR Intents",
    badge: "Paused",
    route: "Paused in this UI",
    disclosure:
      "NEAR Intents is paused in this build.",
    disabled: true,
    comparison: {
      eta: "—",
      feeModel: "—",
      trust: "NEAR Intents solver",
      claim: "—",
      availability: "Unavailable",
      unavailableReason:
        "Paused in this build.",
    },
  },
  agglayer: {
    label: "Agglayer",
    badge: "Testnet",
    route: "Agglayer testnet route",
    disclosure:
      "Bridge ETH between Sepolia and Miden through the canonical testnet bridge. Consume deposited ETH notes in Bread. Gateway auto-claims withdrawals on Sepolia.",
    comparison: {
      eta: "10-20 min",
      feeModel: "No provider fee (canonical bridge)",
      trust: "Agglayer canonical bridge",
      claim: "Consume deposited notes in Bread; Gateway auto-claims withdrawals on Sepolia",
      availability: "Available",
      differentiator: "Canonical ETH route",
    },
  },
  epoch: {
    label: "Epoch",
    badge: "Paused",
    disabled: true,
    route: "Epoch testnet route",
    disclosure:
      "Epoch is represented as a testnet service path. Production assumptions should be revisited when the integration contract is fixed.",
    comparison: {
      eta: "1-3 min",
      feeModel: "Included in quoted rate",
      trust: "Epoch solver network",
      claim: "Solver delivers the Miden note automatically",
      availability: "Unavailable",
      unavailableReason: "Paused in this build.",
      differentiator: "Fastest for USDC",
    },
  },
};

export const modes: Record<
  FlowMode,
  {
    label: string;
    from: string;
    to: string;
    destinationLabel: string;
    destinationPlaceholder: string;
  }
> = {
  receive: {
    label: "Receive",
    from: "Sepolia",
    to: "Miden",
    destinationLabel: "Miden account",
    destinationPlaceholder: "mtst1... or 0x account id",
  },
  send: {
    label: "Send",
    from: "Miden",
    to: "Sepolia",
    destinationLabel: "Sepolia address",
    destinationPlaceholder: "0x...",
  },
};

const timelineCopy: Record<(typeof activitySteps)[number], { label: string; detail: string }> = {
  signature: {
    label: "Sign source transaction",
    detail: "Confirm the transfer in the source wallet.",
  },
  source_finality: {
    label: "Wait for finality",
    detail: "The source transaction needs confirmation before the route can continue.",
  },
  message_observed: {
    label: "Bridge message observed",
    detail: "The provider has observed the message or proof.",
  },
  claim_available: {
    label: "Claim available",
    detail: "Destination funds can be claimed or released.",
  },
  claim_submitted: {
    label: "Claim submitted",
    detail: "The destination claim transaction is waiting for confirmation.",
  },
  complete: {
    label: "Complete",
    detail: "Funds are available in the destination account.",
  },
};

export const timeline = activitySteps.map((status) => ({
  status,
  ...timelineCopy[status],
}));

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
  const quote = quoteForTransfer(route.mode, route.provider, amount, route.destination.symbol);
  return route.provider === "xreserve" && route.source.network !== "arc-testnet"
    ? { ...quote, networkFee: "Gas in ETH", sourceGas: "ETH", warning: "Consume the delivered USDCx note in Bread." } : quote;
}

export function destinationAssetSymbol(activity: Activity): string {
  return activityRoute(activity)?.destination.symbol ?? activity.asset;
}

export function quoteForActivity(activity: Activity): Quote {
  const route = activityRoute(activity);
  if (route) return quoteFor(route, activity.amount);
  return quoteForTransfer(
    activity.mode,
    activity.provider,
    activity.amount,
    activity.asset,
  );
}

function quoteForTransfer(mode: FlowMode, provider: BridgeProvider, amount: string, asset: string): Quote {
  if (provider === "xreserve") return {
    ...quoteAmounts(provider, amount, asset),
    eta: "Delivery time varies",
    networkFee: "Arc gas (USDC)",
    bridgeFee: "Maximum 0 USDC",
    relayerFee: "Included in maximum fee",
    sourceGas: "Arc USDC",
    destinationGas: "Miden USDCx to consume the note",
    warning: "Deposits only. Keep some USDC on Arc for gas. Consume the delivered USDCx note in Bread.",
  };
  const routeName = providers[provider].label;
  // Epoch's quote API returns only the net output amount (no fee breakdown), so
  // don't fabricate specific fees — the cost is baked into the quoted rate.
  const isEpoch = provider === "agglayer" ? false : provider === "epoch";
  const networkFee = provider === "agglayer"
    ? "Sepolia gas"
    : isEpoch
      ? mode === "receive"
        ? "Sepolia gas"
        : "In quoted rate"
      : "0.14 USD";
  const bridgeFee = provider === "agglayer"
    ? "No provider fee"
    : isEpoch
      ? "In quoted rate"
      : "0.05%";
  const relayerFee = provider === "agglayer"
    ? "None"
    : isEpoch
      ? "In quoted rate"
      : "0.03 USD";
  return {
    eta: provider === "agglayer" ? "10-20 min" : "1-3 min",
    networkFee,
    bridgeFee,
    relayerFee,
    ...quoteAmounts(provider, amount, asset),
    sourceGas: mode === "receive" ? "Sepolia ETH" : "Miden fee credit",
    destinationGas: mode === "receive" ? "Miden fee credit" : "Sepolia ETH",
    warning:
      provider === "near-intents"
        ? "Using a project-owned testnet mock, not the official NEAR Intents service."
        : `${routeName} is configured as a testnet route.`,
  };
}

/**
 * Format an Epoch quote amount (base units, or an already-human decimal) to a
 * 2-decimal display string. Mirrors the wallet's send-quote formatting.
 */
export function formatQuoteAmount(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0.00";
  try {
    const human = /^\d+\.\d+$/.test(raw)
      ? raw
      : formatUnits(BigInt(raw), decimals);
    const n = Number(human);
    return Number.isFinite(n) ? n.toFixed(2) : human;
  } catch {
    return raw;
  }
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
    "add-destination": input.mode === "receive" ? "Add Miden account" : "Add Sepolia address",
    insufficient: `Not enough ${input.sourceTokenSymbol}`,
    "quote-loading": "Fetching quote…",
    review: input.mode === "receive" ? "Review receive" : "Review send",
  };
  return {
    action,
    label: labels[action],
    disabled: action !== "connect-source" && action !== "add-destination" && action !== "review",
    opensReview: action === "review",
  };
}

export function statusLabel(status: ActivityStatus) {
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

export function statusTone(status: ActivityStatus) {
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
  const { mode, provider } = route;
  const activity = createBridgeActivity(route, amount);
  const destination = networkLabels[route.destination.network];
  return {
    ...activity,
    summary: mode === "receive"
      ? `Receive ${activity.amount} ${route.destination.symbol} on ${destination}`
      : `Send ${activity.amount} ${activity.asset} to ${destination}`,
    eta: provider === "xreserve" ? "Delivery time varies" : provider === "agglayer" ? "8 min" : "4 min",
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
    const tx = fullHash(activity.sourceTxHash);
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
  const midenTx = fullHash(activity.sourceTxHash) ?? fullHash(activity.midenTxId);
  return {
    label: "View on Midenscan",
    href: midenTx ? `${explorerUrls.miden}/tx/${midenTx}` : undefined,
    available: !!midenTx,
  };
}

// The Agglayer bridge destination encodes the Miden account as
// 0x00000000<15-byte account hex>00. Recover the account id (0x + 30 hex) for a
// Midenscan /account/ link.
function midenAccountFromBridgeDest(dest?: string): string | undefined {
  if (!dest) return undefined;
  const match = /^0x0{8}([0-9a-fA-F]{30})00$/.exec(dest);
  return match ? `0x${match[1].toLowerCase()}` : undefined;
}

export function destinationExplorer(activity: BridgeActivity): ExplorerLink {
  if (activity.mode === "receive") {
    // Midenscan's /tx/ page errors on a cold load (it only renders after a
    // manual refresh — its own message says so), so a deep link to the Miden
    // note-creation tx reads as broken. Link to the recipient account page
    // instead: it loads reliably first-try, and its Transactions / Notes tabs
    // surface the delivered note. Available once the bridge has delivered (the
    // note exists on Miden — status complete / claim tx captured).
    // Prefer the recipient account stored at creation (the only handle an Epoch
    // receive has — it carries no AggLayer bridge destination); fall back to
    // deriving it from the AggLayer bridge destination for older activities.
    const account =
      activity.midenAccountHex ??
      midenAccountFromBridgeDest(activity.bridgeDestinationAddress);
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
  const sepoliaTx =
    fullHash(activity.claimTxHash) ?? fullHash(activity.destinationTxHash);
  return {
    label: "View on Etherscan",
    href: sepoliaTx ? `${explorerUrls.sepolia}/tx/${sepoliaTx}` : undefined,
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
    route: providers[activity.provider].label,
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
      xreserveNoteId: activity.xreserveNoteId,
      xreserveArcTxHash: activity.xreserveArcTxHash,
      xreserveFee: activity.xreserveFee,
      xreserveForwarding: activity.xreserveForwarding,
      xreserveMidenBlock: activity.xreserveMidenBlock,
    }),
    lastMonitorError: extra.monitorError || undefined,
  };
}
