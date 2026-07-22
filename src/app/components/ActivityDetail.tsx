"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  RotateCcw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type AgglayerDepositStatus } from "../lib/agglayer";
import { findMidenToEvmDeposit } from "../lib/agglayer-status";
import {
  agglayerPollMs,
  type BridgeMonitorObservation,
  type ChainTxObservation,
  deriveMonitoredActivity,
  sourceTxPollMs,
  stampLegTimes,
} from "../lib/bridge-monitor";
import {
  type Activity,
  type ActivityStatus,
  activityStartedAt,
  loadStoredActivities,
  quoteFor,
  saveActivities,
  sourceExplorer,
  statusLabel,
  statusTone,
  destinationExplorer,
  timeline,
  buildDiagnostics,
} from "../lib/bridge-state";
import { epochActivityStatus, epochDestinationTx } from "../lib/epoch/epoch-status";
import { MIDEN_DESTINATION_CHAIN_ID } from "../lib/epoch/config";
import { sepoliaGasUnitsFor, useSepoliaGasEstimate } from "../lib/sepolia-gas";
import { formatAgo } from "../lib/relative-time";
import { DEMO_ACTIVITIES } from "../lib/activity-demo";
import { ThemeToggle } from "./ThemeToggle";
import { TempoReceipt } from "./TempoReceipt";

const SEPOLIA_CHAIN_ID = 11155111;

function errorMessage(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  const raw = (
    error instanceof Error ? error.message : String(error ?? "")
  ).toLowerCase();
  if (
    code === 4001 ||
    raw.includes("user rejected") ||
    raw.includes("user denied") ||
    raw.includes("denied transaction") ||
    raw.includes("rejected the request")
  ) {
    return "You cancelled the request in your wallet.";
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error)
    return String(error.message);
  return "Something went wrong. Try again.";
}

function isSepoliaTxHash(value: string | undefined) {
  return Boolean(value && /^0x[0-9a-fA-F]{64}$/.test(value));
}

function isSepoliaAddress(value: string | undefined) {
  return Boolean(value && /^0x[0-9a-fA-F]{40}$/.test(value));
}

function matchingDeposit(status: AgglayerDepositStatus, sourceTxHash?: string) {
  if (!sourceTxHash) return status.latestDeposit;
  const normalized = sourceTxHash.toLowerCase();
  return (
    status.deposits.find(
      (deposit) => deposit.tx_hash?.toLowerCase() === normalized,
    ) ?? null
  );
}

async function fetchSepoliaTx(hash: string): Promise<ChainTxObservation> {
  const response = await fetch(`/api/sepolia/transaction?hash=${hash}`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as
    | ChainTxObservation
    | { error?: string };
  if (!response.ok) {
    throw new Error(
      "error" in payload
        ? (payload.error ?? "Unable to read Sepolia transaction.")
        : "Unable to read Sepolia transaction.",
    );
  }
  return payload as ChainTxObservation;
}

/**
 * Named lifecycle milestones for the labeled progress list, route-aware. Each
 * carries its index into the shared `timeline` state machine so the component
 * can mark done/current/upcoming consistently with the polling state — Receive
 * (Sepolia→Miden) never reaches the Sepolia claim steps, so they're dropped
 * from that direction rather than shown as dead nodes.
 */
function milestonesFor(activity: Activity) {
  // Two genuinely different lifecycles. Epoch is INTENT-BASED: you sign a source
  // action, a solver picks up the intent and delivers the output directly — no
  // claim leg. Agglayer is the CANONICAL BRIDGE: deposit → the bridge observes
  // it → (send only) the exit becomes claimable and is auto-claimed → settled.
  const isEpoch = activity.provider === "epoch";
  const isReceive = activity.mode === "receive";
  type Step = { status: ActivityStatus; label: string; detail: string };

  const signReceive: Step = {
    status: "signature",
    label: "Sign Sepolia deposit",
    detail: "Approve the deposit in your Ethereum wallet.",
  };
  const signSend: Step = {
    status: "signature",
    label: "Sign Miden note",
    detail: isEpoch
      ? "Approve the collateral note in your Bread wallet."
      : "Approve the outbound note in your Bread wallet.",
  };

  let steps: Step[];
  if (isEpoch) {
    steps = isReceive
      ? [
          signReceive,
          {
            status: "source_finality",
            label: "Sepolia confirmation",
            detail: "The deposit confirms on Sepolia.",
          },
          {
            status: "message_observed",
            label: "Solver filling on Miden",
            detail:
              "A solver picked up your intent and is delivering USDC to your Miden account.",
          },
          {
            status: "complete",
            label: "Delivered on Miden",
            detail: "USDC is in your Miden account.",
          },
        ]
      : [
          signSend,
          {
            status: "source_finality",
            label: "Miden confirmation",
            detail: "Your collateral note confirms on Miden.",
          },
          {
            status: "message_observed",
            label: "Solver filling on Sepolia",
            detail:
              "A solver claimed your note and is paying out USDC on Sepolia.",
          },
          {
            status: "complete",
            label: "Settled on Sepolia",
            detail: "USDC delivered to your Sepolia address.",
          },
        ];
  } else {
    steps = isReceive
      ? [
          signReceive,
          {
            status: "source_finality",
            label: "Sepolia confirmation",
            detail: "The deposit confirms on Sepolia and reaches finality.",
          },
          {
            status: "message_observed",
            label: "Observed by the bridge",
            detail:
              "The bridge registered your deposit and is preparing the Miden note.",
          },
          {
            status: "complete",
            label: "Delivered on Miden",
            detail:
              "The note is created on Miden — consume it in your wallet to update your balance.",
          },
        ]
      : [
          signSend,
          {
            status: "source_finality",
            label: "Miden confirmation",
            detail: "The note confirms on Miden before the bridge picks it up.",
          },
          {
            status: "message_observed",
            label: "Building the proof",
            detail:
              "The bridge burned your asset and is proving the exit for Sepolia.",
          },
          {
            status: "claim_available",
            label: "Ready to claim on Sepolia",
            detail:
              "The exit is proven and claimable — it's auto-claimed for you, no action needed.",
          },
          {
            status: "claim_submitted",
            label: "Claim confirming",
            detail: "The Sepolia claim is confirming.",
          },
          {
            status: "complete",
            label: "Settled on Sepolia",
            detail: "Funds released to your Sepolia address.",
          },
        ];
  }

  return steps.map((step) => ({
    ...step,
    timelineIndex: timeline.findIndex((t) => t.status === step.status),
  }));
}

/**
 * The single most important thing right now: a headline + plain-language body
 * that becomes the dominant element on the page (not a muted footnote).
 */
function nextActionFor(activity: Activity): { headline: string; body: string } {
  const isReceive = activity.mode === "receive";
  const isEpoch = activity.provider === "epoch";
  switch (activity.status) {
    case "signature":
      return {
        headline: "Confirm in your wallet",
        body: isReceive
          ? "Approve the Sepolia deposit in your Ethereum wallet to start the transfer."
          : isEpoch
            ? "Approve the collateral note in your Bread wallet to start the transfer."
            : "Approve the outbound note in your Bread wallet to start the transfer.",
      };
    case "source_finality":
      return {
        headline: "Waiting for confirmation",
        body: isReceive
          ? "Your Sepolia deposit is confirming. Nothing for you to do."
          : isEpoch
            ? "Your collateral note is confirming on Miden before a solver fills it. Nothing for you to do."
            : "Your note is confirming on Miden before the bridge picks it up. Nothing for you to do.",
      };
    case "message_observed":
      // Epoch = a solver fills the intent; Agglayer = the canonical bridge.
      if (isEpoch) {
        return {
          headline: "A solver is filling your intent",
          body: isReceive
            ? "A solver picked up your intent and is delivering USDC to your Miden account."
            : "A solver claimed your note and is paying out USDC on your Sepolia address.",
        };
      }
      return {
        headline: "The bridge is processing",
        body: isReceive
          ? "The bridge observed your deposit and is creating the note on Miden."
          : "The bridge burned your asset and is proving the exit for Sepolia.",
      };
    case "claim_available":
      // Agglayer send only — Epoch never reaches this state.
      return {
        headline: "Ready to claim on Sepolia",
        body: "The exit is proven and claimable. It's claimed on Sepolia for you automatically — no action needed.",
      };
    case "claim_submitted":
      return {
        headline: "Confirming on Sepolia",
        body: "The Sepolia claim transaction is waiting for confirmation.",
      };
    case "failed":
      return {
        headline: "This transfer needs attention",
        body: "Progress stopped before the funds settled. Your assets remain accounted for on-chain — review the recovery options below.",
      };
    case "complete":
    default:
      if (!isReceive) {
        return {
          headline: "Funds released on Sepolia",
          body: "The transfer settled and the funds are available in your Sepolia account.",
        };
      }
      // Epoch delivers the USDC directly; Agglayer delivers a note to consume.
      return isEpoch
        ? {
            headline: "Delivered on Miden",
            body: "The USDC is in your Miden account.",
          }
        : {
            headline: "Delivered on Miden — claim in your wallet",
            body: "The bridge created the note on Miden. It won't show in your balance until you consume it in your Bread wallet.",
          };
  }
}

type Guidance = {
  tone: "danger" | "warning" | "success" | "active";
  icon: "alert" | "wallet";
  title: string;
  body: string;
  steps?: string[];
};

/**
 * Route-specific recovery / follow-up panel. Surfaces:
 *  - failed transfers → an explicit recovery path (in-app retry isn't possible
 *    for a broadcast bridge tx, so we say so and route to a new transfer);
 *  - the Miden note-consumption step, kept visibly separate from provider
 *    settlement — the bridge delivering a note is not the same as the wallet
 *    balance updating;
 *  - a Send waiting on the gateway auto-claim (no manual claim by design).
 * Returns null for plain in-flight states, where the hero already says enough.
 */
function guidanceFor(activity: Activity): Guidance | null {
  if (activity.status === "failed") {
    return {
      tone: "danger",
      icon: "alert",
      title: "Recover this transfer",
      body: "Automatic retry isn't available for a bridge transfer once it's broadcast. Start a fresh transfer for the same amount, or copy a diagnostic bundle and share it with support.",
      steps: [
        "Check the source and destination explorers below to see how far the funds moved.",
        "Start a new transfer, or copy diagnostics and contact support.",
      ],
    };
  }
  if (activity.mode === "receive") {
    // Agglayer receive delivers a Miden NOTE that only becomes a balance once
    // consumed in the wallet — so surface that as a distinct user step. Epoch
    // is intent-based: the solver delivers the USDC directly, nothing to claim.
    const delivered =
      activity.status === "complete" || activity.status === "claim_available";
    if (delivered && activity.provider === "agglayer") {
      return {
        tone: "success",
        icon: "wallet",
        title: "Claim the note in your wallet",
        body: "The note is on Miden. Your wallet balance updates only after you consume it.",
        steps: [
          "Open your Bread (Miden) wallet.",
          "Go to Activities → Claim pending notes.",
          "Consume the note to move the funds into your balance.",
        ],
      };
    }
    return null;
  }
  // Agglayer send: the proven exit is auto-claimed on Sepolia — surface it so
  // the wait is legible, but never re-add a manual claim button (removed by
  // design). Epoch send never reaches these states (the solver pays out direct).
  if (activity.status === "claim_available" || activity.status === "claim_submitted") {
    return {
      tone: "active",
      icon: "wallet",
      title: "Auto-claimed on Sepolia",
      body: "The exit is claimed on Sepolia for you automatically. Keep this page open or check back later — no manual claim is required.",
    };
  }
  return null;
}

export function ActivityDetail({ id }: { id: string }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [monitorError, setMonitorError] = useState("");
  const [copied, setCopied] = useState(false);
  // Epoch-ms of the last monitor read; rendered as a live "updated Ns ago" that
  // ticks each second so the page visibly reflects the ≤10s polling cadence.
  const [lastCheckedAt, setLastCheckedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const activity = DEMO_ACTIVITIES[id] ?? activities.find((item) => item.id === id);
  const quote = useMemo(
    () =>
      activity
        ? quoteFor(activity.mode, activity.provider, activity.amount)
        : null,
    [activity],
  );
  // Live Sepolia gas estimate for the network-fee line, matching the swap page.
  const sepoliaGas = useSepoliaGasEstimate(
    activity ? sepoliaGasUnitsFor(activity.mode, activity.provider) : null,
  );
  const networkFeeDisplay = sepoliaGas.fee
    ? sepoliaGas.fee
    : sepoliaGas.loading
      ? "Estimating…"
      : (quote?.networkFee ?? "");

  // Epoch: poll getIntentStatus and advance the activity state machine until terminal.
  useEffect(() => {
    if (
      activity?.provider !== "epoch" ||
      !activity.epochIntentNonce ||
      !activity.epochSponsor
    )
      return;
    if (activity.status === "complete" || activity.status === "failed") return;

    const controller = new AbortController();
    const activityId = activity.id;
    const sponsor = activity.epochSponsor;
    const nonce = activity.epochIntentNonce;
    const isReceive = activity.mode === "receive";
    const destinationChainId = isReceive
      ? MIDEN_DESTINATION_CHAIN_ID
      : SEPOLIA_CHAIN_ID;

    (async () => {
      // epoch-execute pulls the eager-WASM Miden SDK; import lazily so it stays
      // out of SSR (mirrors BridgeExperience.submitTransfer).
      const { pollEpochIntentStatus } = await import("../lib/epoch/epoch-execute");
      await pollEpochIntentStatus({
        sponsorAddress: sponsor,
        intentNonce: nonce,
        // Keep polling until the *destination* leg settles (Sepolia for a send)
        // — not just the Miden source leg — so the page advances to complete on
        // its own without a manual refresh.
        destinationChainId,
        signal: controller.signal,
        onUpdate: (statuses) => {
          const nextStatus = epochActivityStatus(statuses, destinationChainId);
          // Capture the settled fulfillment tx so the explorer link deep-links
          // the real bridging tx: Miden delivery (receive) / Sepolia payout
          // (send). Receive's Miden tx also drives the Midenscan link off the
          // tx list.
          const destTx = epochDestinationTx(statuses, destinationChainId);
          setActivities((current) => {
            const updated = current.map((item) => {
              if (item.id !== activityId) return item;
              const withTx = destTx
                ? isReceive
                  ? {
                      midenTxId: item.midenTxId ?? destTx,
                      destinationTxHash: item.destinationTxHash ?? destTx,
                    }
                  : { destinationTxHash: item.destinationTxHash ?? destTx }
                : {};
              return stampLegTimes({
                ...item,
                ...withTx,
                status: nextStatus,
                updatedAt: Date.now(),
              });
            });
            saveActivities(updated);
            return updated;
          });
          setLastCheckedAt(Date.now());
        },
      });
    })().catch(() => undefined);

    return () => controller.abort();
  }, [
    activity?.provider,
    activity?.epochIntentNonce,
    activity?.epochSponsor,
    activity?.id,
    activity?.mode,
    activity?.status,
  ]);
  const sourceLink = activity ? sourceExplorer(activity) : null;
  const destinationLink = activity ? destinationExplorer(activity) : null;
  // Which timeline step we're on, so the labeled milestone list marks
  // done/current/upcoming as the transfer advances.
  const currentIndex = activity
    ? timeline.findIndex((step) => step.status === activity.status)
    : -1;
  const isComplete = activity?.status === "complete";
  const isFailed = activity?.status === "failed";
  const nextAction = activity ? nextActionFor(activity) : null;
  const guidance = activity ? guidanceFor(activity) : null;
  const milestones = activity ? milestonesFor(activity) : [];
  // The tx on each chain, shown as its own labeled row on the receipt. Source is
  // the leg the user signed (Sepolia deposit for a receive, Miden note for a
  // send); destination is where the funds land (the Miden note / the Sepolia
  // payout). Either can be absent while that leg is still pending.
  const sourceHash = activity
    ? activity.sourceTxHash ??
      (activity.mode === "send" ? activity.midenTxId : undefined)
    : undefined;
  const destinationHash = activity
    ? activity.mode === "receive"
      ? activity.midenTxId ?? activity.destinationTxHash
      : activity.claimTxHash ?? activity.destinationTxHash
    : undefined;
  // Per-leg transaction times. Source is the transfer's start — for legacy rows
  // that's the id-encoded creation time (via activityStartedAt), NOT updatedAt,
  // so it stays distinct from the destination. Destination shows "—" until that
  // leg's tx exists; once the hash is present but wasn't stamped (e.g. a transfer
  // that settled before we tracked it) fall back to updatedAt (≈ settlement), so
  // source (creation) and destination (settlement) still yield a real duration.
  const sourceTxAt = activity ? activityStartedAt(activity) : undefined;
  const destinationTxAt =
    activity?.destinationTxAt ??
    (destinationHash ? activity?.updatedAt : undefined);

  const observeActivity = useCallback(
    (activityId: string, observation: BridgeMonitorObservation) => {
      setActivities((current) => {
        const currentActivity =
          current.find((item) => item.id === activityId) ?? activity;
        if (!currentActivity) return current;
        const nextActivity = deriveMonitoredActivity(
          currentActivity,
          observation,
        );
        const updated = current.some((item) => item.id === activityId)
          ? current.map((item) =>
              item.id === activityId ? nextActivity : item,
            )
          : [nextActivity, ...current];
        saveActivities(updated);
        setLastCheckedAt(Date.now());
        setMonitorError("");
        return updated;
      });
    },
    [activity],
  );

  useEffect(() => {
    try {
      const stored = loadStoredActivities();
      queueMicrotask(() => setActivities(stored));
    } catch {
      queueMicrotask(() => setActivities([]));
    }
  }, []);

  // Whether this activity is still mid-flight — drives how aggressively we poll.
  const isActive =
    !activity ||
    (activity.status !== "complete" && activity.status !== "failed");

  // Tick a 1s clock while the transfer is live so the "updated Ns ago" label
  // advances in real time — a visible signal that monitoring is current.
  useEffect(() => {
    if (!isActive) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [isActive]);

  const lastCheckedLabel =
    lastCheckedAt && now ? formatAgo(Math.max(0, now - lastCheckedAt)) : "";

  // Copy a support-safe diagnostic bundle (ids, route, status, timestamps,
  // addresses, tx hashes, last monitor error — never any secret). The "Copied"
  // confirmation auto-clears so the control reads clearly on repeat use.
  const copyDiagnostics = useCallback(async () => {
    if (!activity) return;
    const bundle = buildDiagnostics(activity, { monitorError, lastCheckedAt });
    const text = JSON.stringify(bundle, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard can be blocked (permissions / insecure context); leave the
      // control unconfirmed rather than throwing.
    }
  }, [activity, monitorError, lastCheckedAt]);

  // Re-read persisted activities on tab focus and on a tick. This keeps the
  // detail page live without a manual refresh: it picks up updates written by the
  // submit flow that keeps running after it navigated here, and re-syncs when the
  // user returns from a wallet popup / another tab. The tick is fast while the
  // transfer is in progress and slow once it's settled (complete/failed).
  useEffect(() => {
    const reload = () => {
      try {
        setActivities(loadStoredActivities());
      } catch {
        // ignore transient storage read errors
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(reload, isActive ? 3_000 : 30_000);
    return () => {
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [isActive]);

  useEffect(() => {
    if (
      !activity?.bridgeDestinationAddress ||
      activity.provider !== "agglayer" ||
      activity.mode !== "receive"
    )
      return;
    if (activity.status === "failed") return;
    // Keep polling after "complete" until the Miden note-creation tx is captured
    // (claim_tx_hash → midenTxId). The indexer flips ready_for_claim to true a
    // little before it publishes claim_tx_hash, so stopping at "complete" would
    // permanently leave the Midenscan link disabled. Once midenTxId is set, the
    // deep link is live and there's nothing left to fetch.
    if (activity.status === "complete" && activity.midenTxId) return;

    let cancelled = false;
    const activityId = activity.id;
    const bridgeDestinationAddress = activity.bridgeDestinationAddress;
    const sourceTxHash = activity.sourceTxHash;
    async function pollAgglayerStatus() {
      const response = await fetch(
        `/api/agglayer/deposits?destinationAddress=${bridgeDestinationAddress}`,
      );
      if (!response.ok || cancelled) return;
      const status = (await response.json()) as AgglayerDepositStatus;
      const latestDeposit = matchingDeposit(status, sourceTxHash);

      setActivities((current) => {
        const currentActivity =
          current.find((item) => item.id === activityId) ?? activity;
        if (!currentActivity) return current;
        const updatedActivity = deriveMonitoredActivity(currentActivity, {
          checkedAt: "Just now",
          agglayerDeposit: latestDeposit,
        });
        const updated = current.map((item) => {
          if (item.id !== activityId) return item;
          return updatedActivity;
        });
        saveActivities(updated);
        setLastCheckedAt(Date.now());
        setMonitorError("");
        return updated;
      });
    }

    pollAgglayerStatus().catch(() => undefined);
    const interval = window.setInterval(() => {
      pollAgglayerStatus().catch(() => undefined);
    }, agglayerPollMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    activity,
    activity?.bridgeDestinationAddress,
    activity?.id,
    activity?.mode,
    activity?.provider,
    activity?.sourceTxHash,
    activity?.status,
    activity?.midenTxId,
  ]);

  useEffect(() => {
    if (
      !activity ||
      activity.provider !== "agglayer" ||
      activity.mode !== "receive"
    )
      return;
    if (activity.status === "complete" || activity.status === "failed") return;
    if (!isSepoliaTxHash(activity.sourceTxHash)) return;

    let cancelled = false;
    const activityId = activity.id;
    const sourceHash = activity.sourceTxHash;

    async function pollSourceTransaction() {
      try {
        const sourceTx = await fetchSepoliaTx(sourceHash!);
        if (cancelled) return;
        observeActivity(activityId, { checkedAt: "Just now", sourceTx });
      } catch (error) {
        if (!cancelled) setMonitorError(errorMessage(error));
      }
    }

    pollSourceTransaction();
    const interval = window.setInterval(pollSourceTransaction, sourceTxPollMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activity?.id,
    activity?.mode,
    activity?.provider,
    activity?.sourceTxHash,
    activity?.status,
  ]);

  useEffect(() => {
    if (
      !activity ||
      activity.provider !== "agglayer" ||
      activity.mode !== "send"
    )
      return;
    if (activity.status === "complete" || activity.status === "failed") return;
    if (!isSepoliaAddress(activity.destination)) return;
    if (activity.status === "claim_submitted") return;

    let cancelled = false;
    const activityId = activity.id;
    const destination = activity.destination as string; // guarded by isSepoliaAddress above
    const knownDepositCount = activity.depositCount;

    // Direct against the public bridge indexer (no local backend proxy): the
    // deposit is discoverable by its Sepolia destination address. Track the exit
    // through its whole lifecycle (not just the claimable window) so we detect
    // the gateway auto-claim — `ready_for_claim` flips false once claimed, but
    // `claim_tx_hash` is populated, which settles the send automatically.
    async function pollClaimReadiness() {
      try {
        const deposit = await findMidenToEvmDeposit(destination, knownDepositCount);
        if (cancelled) return;
        observeActivity(activityId, {
          checkedAt: "Just now",
          claimPlan: {
            readyForClaim: Boolean(deposit?.ready_for_claim),
            depositCount: deposit?.deposit_cnt,
            claimTxHash: deposit?.claim_tx_hash || undefined,
          },
        });
      } catch (error) {
        if (!cancelled) setMonitorError(errorMessage(error));
      }
    }

    pollClaimReadiness();
    const interval = window.setInterval(pollClaimReadiness, agglayerPollMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activity?.depositCount,
    activity?.destination,
    activity?.id,
    activity?.mode,
    activity?.provider,
    activity?.status,
  ]);

  return (
    <main className="detail-shell">
      <header className="detail-topbar">
        <Link className="brand" href="/" aria-label="Back to bridge">
          <Image
            src="/miden-logo-horizontal.svg"
            alt="Miden"
            width={112}
            height={34}
            priority
          />
          <span>Bridge</span>
        </Link>
        <div className="detail-topbar-actions">
          <ThemeToggle />
          <Link className="back-link" href="/">
            <ArrowLeft size={17} aria-hidden="true" />
            New transfer
          </Link>
        </div>
      </header>

      {!activity || !quote ? (
        <section className="detail-empty">
          <h1>Activity not found</h1>
          <p>This transfer isn&apos;t in local activity history on this browser.</p>
          <Link className="primary-button" href="/">
            Back to bridge
          </Link>
        </section>
      ) : (
        <section className="detail-simple detail-complete">
          {nextAction ? (
            <p
              className="sr-only activity-status-announcement"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {statusLabel(activity.status)}. {nextAction.headline}
            </p>
          ) : null}

          {/* One receipt card backs every state; an in-flight or failed transfer
              adds a status pill and reads "Expected" instead of "Received". */}
          <TempoReceipt
            activity={activity}
            received={activity.receivedAmount ?? quote.expectedReceived}
            networkFee={networkFeeDisplay}
            sourceLink={sourceLink}
            destinationLink={destinationLink}
            sourceHash={sourceHash}
            destinationHash={destinationHash}
            sourceTxAt={sourceTxAt}
            destinationTxAt={destinationTxAt}
            status={
              isComplete
                ? undefined
                : {
                    label: statusLabel(activity.status),
                    tone: statusTone(activity.status),
                  }
            }
            pending={!isComplete}
          />

          {/* Bridge steps — a compact confirmed checklist once settled, the full
              live timeline (with per-step detail) while in flight or failed. */}
          <div className={`steps-card ${isComplete ? "compact" : ""}`}>
            <p className="steps-card-title">Bridge steps</p>
            <ol className="milestone-list">
              {milestones.map((milestone) => {
                const failedAtDestination = /destination/i.test(activity.eta);
                const failedIndex = failedAtDestination
                  ? timeline.findIndex((s) => s.status === "claim_submitted")
                  : timeline.findIndex((s) => s.status === "source_finality");
                const state = isComplete
                  ? "done"
                  : isFailed
                    ? milestone.timelineIndex < failedIndex
                      ? "done"
                      : milestone.timelineIndex === failedIndex
                        ? "failed"
                        : "upcoming"
                    : milestone.timelineIndex < currentIndex
                      ? "done"
                      : milestone.timelineIndex === currentIndex
                        ? "current"
                        : "upcoming";
                return (
                  <li key={milestone.status} className={`milestone ${state}`}>
                    <span className="milestone-marker" aria-hidden="true">
                      {state === "done" ? (
                        <Check size={12} />
                      ) : state === "failed" ? (
                        <AlertTriangle size={12} />
                      ) : null}
                    </span>
                    <div className="milestone-copy">
                      <strong>{milestone.label}</strong>
                      <span>{milestone.detail}</span>
                    </div>
                  </li>
                );
              })}
              {/* Agglayer receive delivers a Miden note that isn't a balance
                  change until consumed in the wallet — kept as a distinct step.
                  Epoch's solver delivers the USDC directly, so no consume step. */}
              {activity.mode === "receive" && activity.provider === "agglayer" ? (
                <li
                  className={`milestone consume ${
                    isComplete || activity.status === "claim_available"
                      ? "current"
                      : "upcoming"
                  }`}
                >
                  <span className="milestone-marker" aria-hidden="true">
                    <Wallet size={12} />
                  </span>
                  <div className="milestone-copy">
                    <strong>Consume note in your wallet</strong>
                    <span>
                      Balance updates only after you claim the note in Bread —
                      this happens in your wallet, not here.
                    </span>
                  </div>
                </li>
              ) : null}
            </ol>

            {!isComplete && !isFailed ? (
              <p className="steps-note">
                <ShieldCheck size={13} aria-hidden="true" />
                Safe to leave — this keeps progressing on-chain and monitoring
                resumes when you reopen this page.
                {lastCheckedLabel ? ` Updated ${lastCheckedLabel}.` : ""}
              </p>
            ) : null}
          </div>

          {/* Recovery / follow-up, in the same restrained card language. */}
          {guidance ? (
            <div className={`action-panel ${guidance.tone}`}>
              <div className="action-panel-head">
                {guidance.icon === "alert" ? (
                  <AlertTriangle size={16} aria-hidden="true" />
                ) : (
                  <Wallet size={16} aria-hidden="true" />
                )}
                <strong>{guidance.title}</strong>
              </div>
              <p>{guidance.body}</p>
              {guidance.steps ? (
                <ol className="action-panel-steps">
                  {guidance.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : null}
              {isFailed ? (
                <Link className="primary-button" href="/">
                  <RotateCcw size={16} aria-hidden="true" />
                  Start a new transfer
                </Link>
              ) : null}
            </div>
          ) : null}

          {monitorError ? (
            <p className="form-error compact">{monitorError}</p>
          ) : null}

          {/* Support: a diagnostic bundle is one click away while a transfer is
              still live or has failed. */}
          {!isComplete ? (
            <div className="support-row">
              <button
                type="button"
                className="secondary-button"
                onClick={copyDiagnostics}
              >
                {copied ? (
                  <Check size={15} aria-hidden="true" />
                ) : (
                  <Copy size={15} aria-hidden="true" />
                )}
                {copied ? "Diagnostics copied" : "Copy diagnostics"}
              </button>
            </div>
          ) : null}
        </section>
      )}
    </main>
  );
}
