import { activitySteps, type ActivityStatus } from "./activity-status";
import { sameAsset } from "./assets";
import type { BridgeRoute } from "./routes";
import type { BridgeActivity, BridgeProvider, BridgeQuote } from "./models";

/** Clear the amount when the selected source network or token changes. */
export function routeSwitchChangesAsset(from: BridgeRoute, to: BridgeRoute): boolean {
  return !sameAsset(from.source, to.source);
}

/** Fallback quote amounts used until a live provider quote is available. */
export function quoteAmounts(provider: BridgeProvider, amount: string, asset: string): BridgeQuote {
  // With maxFee=0, xReserve must deliver the full amount or reject the deposit.
  // Preserve decimal text: converting via Number loses micro-USDC above 2^53.
  if (provider === "xreserve") {
    const value = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount.trim()) ? amount.trim() : "0";
    return { asset, expectedReceived: value, minReceived: value };
  }
  const parsedAmount = Number(amount) || 0;
  // Agglayer is a canonical 1:1 bridge; other routes carry a small fee spread.
  const isOneToOne = provider === "agglayer";
  const expected = isOneToOne ? parsedAmount : Math.max(parsedAmount * 0.999, 0);
  const minMultiplier = isOneToOne ? 1 : 0.995;
  return {
    asset,
    expectedReceived: String(Number(expected.toFixed(6))),
    minReceived: String(Number((expected * minMultiplier).toFixed(6))),
  };
}

// A finite, strictly-positive amount is the floor for any wallet prompt: empty,
// zero, negative, malformed ("1.2.3" → NaN), and non-finite ("1e999" → Infinity)
// inputs all fail this and can never advance the flow.
export function isValidAmount(amount: string): boolean {
  const parsed = Number(amount);
  return Number.isFinite(parsed) && parsed > 0;
}

export type TransferAction =
  | "submitting"
  | "enter-amount"
  | "connect-source"
  | "add-destination"
  | "insufficient"
  | "quote-loading"
  | "review";

export interface TransferInputs {
  sourceConnected: boolean;
  hasDestination: boolean;
  amount: string;
  insufficientBalance: boolean;
  quoteLoading: boolean;
  isSubmitting: boolean;
}

/** Evaluate transfer prerequisites in order before allowing wallet submission. */
export function deriveTransferAction(input: TransferInputs): TransferAction {
  if (input.isSubmitting) return "submitting";
  if (!isValidAmount(input.amount)) return "enter-amount";
  if (!input.sourceConnected) return "connect-source";
  if (!input.hasDestination) return "add-destination";
  if (input.insufficientBalance) return "insufficient";
  if (input.quoteLoading) return "quote-loading";
  return "review";
}

export function nextStatus(activity: BridgeActivity): ActivityStatus {
  if (activity.status === "failed") return "claim_available";
  const index = activitySteps.findIndex((status) => status === activity.status);
  if (index === -1) return "signature";
  return activitySteps[Math.min(index + 1, activitySteps.length - 1)];
}

export function createActivity(
  route: BridgeRoute,
  amount: string,
): BridgeActivity {
  const activity: BridgeActivity = {
    id: `act-${Date.now().toString(36)}`,
    mode: route.mode,
    provider: route.provider,
    routeId: route.id,
    status: "signature",
    amount: amount || "0",
    asset: route.source.symbol,
    // Honest pending defaults — the real hashes are filled in by the submit flow
    // as the transfer progresses (no fabricated tx hashes on a pending activity).
    sourceTxHash: undefined,
    destinationTxHash: undefined,
    midenTxId: undefined,
    updatedAt: Date.now(),
    // The activity is born when the source leg is submitted, so this is the
    // source-chain transaction time.
    sourceTxAt: Date.now(),
  };

  return activity;
}

/**
 * When the transfer began = the source-chain transaction time. Prefers the
 * stamped `sourceTxAt`, else the id-encoded creation time (`act-<base36 ms>`),
 * else the row's `updatedAt`. Used so the history list counts forward from when
 * the transfer was initiated, not from the last monitor poll.
 */
export function activityStartedAt(activity: BridgeActivity): number {
  if (activity.sourceTxAt) return activity.sourceTxAt;
  const match = /^act-([0-9a-z]+)$/.exec(activity.id);
  const fromId = match ? parseInt(match[1], 36) : NaN;
  if (Number.isFinite(fromId) && fromId > 1_600_000_000_000) return fromId;
  return activity.updatedAt;
}

/**
 * Stamp each leg's transaction time the first time its hash appears, and never
 * again (idempotent) — so re-observing a settled transfer doesn't overwrite when
 * a leg actually landed. Source is usually already stamped at creation; this
 * backfills it for activities that arrive hash-first (e.g. merged history).
 */
export function stampLegTimes<T extends BridgeActivity>(activity: T): T {
  const now = Date.now();
  let next = activity;
  if (next.sourceTxHash && !next.sourceTxAt) {
    // The source leg is the transfer's start — use its real start time (id-
    // encoded creation), never "now", so a late backfill can't read as "just now".
    next = { ...next, sourceTxAt: activityStartedAt(next) };
  }
  const hasDestinationTx = Boolean(
    next.destinationTxHash || next.midenTxId || next.claimTxHash,
  );
  if (hasDestinationTx && !next.destinationTxAt) {
    next = { ...next, destinationTxAt: now };
  }
  return next;
}
