export type BridgeProvider = "near-intents" | "agglayer" | "epoch";
export type FlowMode = "receive" | "send";
export type ActivityStatus =
  | "signature"
  | "source_finality"
  | "message_observed"
  | "claim_available"
  | "claim_submitted"
  | "failed"
  | "complete";

export type Quote = {
  eta: string;
  networkFee: string;
  bridgeFee: string;
  relayerFee: string;
  expectedReceived: string;
  minReceived: string;
  sourceGas: string;
  destinationGas: string;
  warning: string;
};

export type Activity = {
  id: string;
  mode: FlowMode;
  provider: BridgeProvider;
  summary: string;
  status: ActivityStatus;
  eta: string;
  amount: string;
  asset: string;
  destination?: string;
  bridgeDestinationAddress?: string;
  txHash: string;
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
  /** Real quoted output amount at execution (e.g. "99.17 USDC"), when known. */
  receivedAmount?: string;
  /** Owner tags for per-account filtering of account-derived history. */
  evmAddress?: string;
  midenAccount?: string;
  /** Source-relative ordering hint (higher = newer) for merged remote history. */
  sortKey?: number;
  updatedAt: string;
};

export const activityStorageKey = "miden.bridge.ui.activities";

export const providers: Record<
  BridgeProvider,
  {
    label: string;
    badge: string;
    route: string;
    disclosure: string;
    disabled?: boolean;
  }
> = {
  "near-intents": {
    label: "NEAR Intents",
    badge: "Paused",
    route: "Paused in this UI",
    disclosure:
      "NEAR Intents is intentionally disabled in this build while AggLayer and Epoch are the active testnet routes.",
    disabled: true,
  },
  agglayer: {
    label: "AggLayer",
    badge: "Testnet",
    route: "AggLayer testnet route",
    disclosure:
      "AggLayer routes Sepolia→Miden through the canonical bridge with no provider fee. Miden→Sepolia send is not available yet (needs Miden SDK B2AGG note support); the Sepolia-side claimAsset is built in-app once the outbound note lands.",
  },
  epoch: {
    label: "Epoch",
    badge: "Testnet",
    route: "Epoch testnet route",
    disclosure:
      "Epoch is represented as a testnet service path. Production assumptions should be revisited when the integration contract is fixed.",
  },
};

export const modes: Record<
  FlowMode,
  {
    label: string;
    from: string;
    to: string;
    assetIn: string;
    assetOut: string;
    destinationLabel: string;
    destinationPlaceholder: string;
  }
> = {
  receive: {
    label: "Receive",
    from: "Sepolia",
    to: "Miden",
    assetIn: "ETH",
    assetOut: "Miden ETH",
    destinationLabel: "Miden account",
    destinationPlaceholder: "mcst1... or 0x account id",
  },
  send: {
    label: "Send",
    from: "Miden",
    to: "Sepolia",
    assetIn: "Miden ETH",
    assetOut: "ETH",
    destinationLabel: "Sepolia address",
    destinationPlaceholder: "0x...",
  },
};

export const timeline: Array<{ status: ActivityStatus; label: string; detail: string }> = [
  {
    status: "signature",
    label: "Sign source transaction",
    detail: "Confirm the transfer in the source wallet.",
  },
  {
    status: "source_finality",
    label: "Wait for finality",
    detail: "The source transaction needs confirmation before the route can continue.",
  },
  {
    status: "message_observed",
    label: "Bridge message observed",
    detail: "The provider has observed the message or proof.",
  },
  {
    status: "claim_available",
    label: "Claim available",
    detail: "Destination funds can be claimed or released.",
  },
  {
    status: "claim_submitted",
    label: "Claim submitted",
    detail: "The destination claim transaction is waiting for confirmation.",
  },
  {
    status: "complete",
    label: "Complete",
    detail: "Funds are available in the destination account.",
  },
];

export const explorerUrls = {
  sepolia: "https://sepolia.etherscan.io",
  miden: "https://testnet.midenscan.com",
};

export function shortAddress(value: string) {
  if (value.length <= 16) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

/**
 * Deterministic account-avatar gradient derived from an address (Uniswap-style):
 * two hues seeded from the string so each account has a stable, distinct swatch.
 */
export function walletGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const a = h % 360;
  const b = (a + 60 + ((h >> 8) % 120)) % 360;
  return `linear-gradient(135deg, hsl(${a} 72% 58%), hsl(${b} 68% 46%))`;
}

export function quoteFor(mode: FlowMode, provider: BridgeProvider, amount: string): Quote {
  const parsedAmount = Number(amount) || 0;
  // AggLayer is a canonical 1:1 bridge (no provider fee), so what you send is
  // what you receive. Other routes carry a small fee spread.
  const isOneToOne = provider === "agglayer";
  const expected = isOneToOne
    ? parsedAmount
    : Math.max(parsedAmount * 0.999, 0);
  const minMultiplier = isOneToOne ? 1 : 0.995;
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
  // Token depends on the route: AggLayer bridges ETH, Epoch bridges USDC.
  // The mode-based assetOut ("Miden ETH") is only correct for AggLayer.
  const outSymbol =
    provider === "epoch" ? "USDC" : modes[mode].assetOut.replace("Miden ", "");

  return {
    eta: provider === "agglayer" ? (mode === "receive" ? "About 15 min" : "30-90 min") : "1-3 min",
    networkFee,
    bridgeFee,
    relayerFee,
    expectedReceived: `${expected.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${outSymbol}`,
    minReceived: `${(expected * minMultiplier).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${outSymbol}`,
    sourceGas: mode === "receive" ? "Sepolia ETH" : "Miden fee credit",
    destinationGas: mode === "receive" ? "Miden fee credit" : "Sepolia ETH",
    warning:
      provider === "near-intents"
        ? "Using a project-owned testnet mock, not the official NEAR Intents service."
        : `${routeName} is configured as a testnet route.`,
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

export function nextStatus(activity: Activity): ActivityStatus {
  if (activity.status === "failed") return "claim_available";
  const index = timeline.findIndex((step) => step.status === activity.status);
  if (index === -1) return "signature";
  return timeline[Math.min(index + 1, timeline.length - 1)].status;
}

export function createActivity(
  mode: FlowMode,
  provider: BridgeProvider,
  amount: string,
  overrides: Partial<Activity> = {},
): Activity {
  const copy = modes[mode];
  // Token depends on the route: Epoch bridges USDC, AggLayer/others bridge ETH.
  const asset =
    provider === "epoch" ? "USDC" : copy.assetIn.replace("Miden ", "");
  const destination = mode === "receive" ? "Miden" : "Sepolia";

  const activity: Activity = {
    id: `act-${Date.now().toString(36)}`,
    mode,
    provider,
    summary: mode === "receive" ? `Receive ${amount || "0"} ${asset} on ${destination}` : `Send ${amount || "0"} ${asset} to ${destination}`,
    status: "signature",
    eta: provider === "agglayer" ? "8 min" : "4 min",
    amount: amount || "0",
    asset,
    // Honest pending defaults — the real hashes are filled in by the submit flow
    // as the transfer progresses (no fabricated tx hashes on a pending activity).
    txHash: "0xpending",
    sourceTxHash: undefined,
    destinationTxHash: undefined,
    midenTxId: undefined,
    updatedAt: "Just now",
  };

  return { ...activity, ...overrides };
}

export function sourceExplorer(activity: Activity) {
  if (activity.mode === "receive") {
    return {
      label: "View on Etherscan",
      href: `${explorerUrls.sepolia}/tx/${activity.sourceTxHash ?? activity.txHash}`,
    };
  }
  return {
    label: "View on Midenscan",
    href: `${explorerUrls.miden}/txs`,
  };
}

export function destinationExplorer(activity: Activity) {
  if (activity.mode === "receive") {
    // The destination tx = the Miden note-creation tx (AggLayer's destination
    // claim), captured from the deposit's claim_tx_hash. Link straight to it
    // when known; fall back to the tx list before it's observed.
    const midenTx = activity.midenTxId ?? activity.destinationTxHash;
    return {
      label: "View on Midenscan",
      href: midenTx ? `${explorerUrls.miden}/tx/${midenTx}` : `${explorerUrls.miden}/txs`,
    };
  }
  return {
    label: "View on Etherscan",
    href: `${explorerUrls.sepolia}/tx/${activity.claimTxHash ?? activity.destinationTxHash ?? activity.txHash}`,
  };
}

function normalizeActivity(activity: Activity): Activity {
  const legacyMode = activity.mode as FlowMode | "deposit" | "withdraw";
  const mode: FlowMode = legacyMode === "deposit" ? "receive" : legacyMode === "withdraw" ? "send" : legacyMode;
  const summary = activity.summary
    .replace(/^Deposit\b/, "Receive")
    .replace(/^Withdraw\b/, "Send")
    .replace(/^Receive (.+) to Miden$/, "Receive $1 on Miden");
  return { ...activity, mode, summary };
}

export function loadStoredActivities(): Activity[] {
  const raw = window.localStorage.getItem(activityStorageKey);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as Activity[];
  return Array.isArray(parsed) ? parsed.map(normalizeActivity) : [];
}

export function saveActivities(activities: Activity[]) {
  window.localStorage.setItem(activityStorageKey, JSON.stringify(activities));
}

/**
 * Merge a patch into one stored activity by id and persist. Used by the submit
 * flow to update an already-navigated-to activity as the (backgrounded)
 * execution progresses, so the detail page reflects it on its next re-read.
 */
export function patchStoredActivity(id: string, patch: Partial<Activity>) {
  try {
    const activities = loadStoredActivities();
    saveActivities(
      activities.map((item) =>
        item.id === id ? { ...item, ...patch, updatedAt: "Just now" } : item,
      ),
    );
  } catch {
    // ignore transient storage errors
  }
}
