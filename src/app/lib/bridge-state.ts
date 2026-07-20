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
  /** Recipient Miden account id (0x + 30 hex) for a receive — drives the
   * Midenscan account link when there's no AggLayer bridge destination (Epoch). */
  midenAccountHex?: string;
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
  updatedAt: number;
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
      "NEAR Intents is intentionally disabled in this build while Agglayer and Epoch are the active testnet routes.",
    disabled: true,
  },
  agglayer: {
    label: "Agglayer",
    badge: "Testnet",
    route: "Agglayer testnet route",
    disclosure:
      "Agglayer routes Sepolia→Miden through the canonical bridge with no provider fee. Miden→Sepolia send is not available yet (needs Miden SDK B2AGG note support); the Sepolia-side claimAsset is built in-app once the outbound note lands.",
  },
  epoch: {
    label: "Epoch",
    badge: "Testnet",
    route: "Epoch testnet route",
    disclosure:
      "Epoch is represented as a testnet service path. Production assumptions should be revisited when the integration contract is fixed.",
  },
};

// Persist the last-selected route so a refresh returns to it (e.g. Agglayer)
// instead of snapping back to the Epoch default every time.
const routeStorageKey = "miden.bridge.ui.route";

export function loadStoredRoute(): BridgeProvider | null {
  try {
    const value = window.localStorage.getItem(routeStorageKey);
    if (value && value in providers && !providers[value as BridgeProvider].disabled)
      return value as BridgeProvider;
  } catch {
    // ignore storage access failures (SSR / privacy mode)
  }
  return null;
}

export function saveStoredRoute(provider: BridgeProvider) {
  try {
    window.localStorage.setItem(routeStorageKey, provider);
  } catch {
    // ignore storage write failures
  }
}

// Persist the Send/Receive tab so a refresh keeps the current direction instead
// of snapping back to Receive every time.
const modeStorageKey = "miden.bridge.ui.mode";

export function loadStoredMode(): FlowMode | null {
  try {
    const value = window.localStorage.getItem(modeStorageKey);
    if (value === "receive" || value === "send") return value;
  } catch {
    // ignore storage access failures (SSR / privacy mode)
  }
  return null;
}

export function saveStoredMode(mode: FlowMode) {
  try {
    window.localStorage.setItem(modeStorageKey, mode);
  } catch {
    // ignore storage write failures
  }
}

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
  // Agglayer is a canonical 1:1 bridge (no provider fee), so what you send is
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
  // Token depends on the route: Agglayer bridges ETH, Epoch bridges USDC.
  // The mode-based assetOut ("Miden ETH") is only correct for Agglayer.
  const outSymbol =
    provider === "epoch" ? "USDC" : modes[mode].assetOut.replace("Miden ", "");

  return {
    eta: provider === "agglayer" ? "10-20 min" : "1-3 min",
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
  // Token depends on the route: Epoch bridges USDC, Agglayer/others bridge ETH.
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
    updatedAt: Date.now(),
  };

  return { ...activity, ...overrides };
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

export function sourceExplorer(activity: Activity): ExplorerLink {
  if (activity.mode === "receive") {
    // Source = the Sepolia deposit the user signed.
    const tx = fullHash(activity.sourceTxHash);
    return {
      label: "View on Etherscan",
      href: tx ? `${explorerUrls.sepolia}/tx/${tx}` : undefined,
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

export function destinationExplorer(activity: Activity): ExplorerLink {
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

function normalizeActivity(activity: Activity): Activity {
  const legacyMode = activity.mode as FlowMode | "deposit" | "withdraw";
  const mode: FlowMode = legacyMode === "deposit" ? "receive" : legacyMode === "withdraw" ? "send" : legacyMode;
  const summary = activity.summary
    .replace(/^Deposit\b/, "Receive")
    .replace(/^Withdraw\b/, "Send")
    .replace(/^Receive (.+) to Miden$/, "Receive $1 on Miden");
  // Migrate pre-timestamp rows: `updatedAt` used to be a display string ("Just
  // now"). Coerce any non-number to 0, then backfill from the id — createActivity
  // stamps `act-<base36 creation-ms>`, so old rows can still show a real time
  // instead of "—".
  let updatedAt =
    typeof activity.updatedAt === "number" ? activity.updatedAt : 0;
  if (!updatedAt) {
    const match = /^act-([0-9a-z]+)$/.exec(activity.id);
    const fromId = match ? parseInt(match[1], 36) : NaN;
    // Guard against non-timestamp ids: only accept a plausible epoch-ms value.
    if (Number.isFinite(fromId) && fromId > 1_600_000_000_000) updatedAt = fromId;
  }
  return { ...activity, mode, summary, updatedAt };
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
        item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item,
      ),
    );
  } catch {
    // ignore transient storage errors
  }
}
