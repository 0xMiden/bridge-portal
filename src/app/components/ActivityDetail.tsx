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
import type { ActivityStatus } from "../../bridge/core/activity-status";
import {
  type Activity,
  quoteForActivity,
  destinationAssetSymbol,
  sourceExplorer,
  statusLabel,
  statusTone,
  destinationExplorer,
  timeline,
  buildDiagnostics,
} from "../lib/bridge-presentation";
import { activityStartedAt } from "../../bridge/core/rules";
import { sepoliaGasUnitsFor, useSepoliaGasEstimate } from "../lib/sepolia-gas";
import { formatAgo } from "../lib/relative-time";
import { useActivityTracking } from "../lib/use-activity-tracking";
import { ThemeToggle } from "./ThemeToggle";
import { TempoReceipt } from "./TempoReceipt";

/**
 * Named lifecycle milestones for the labeled progress list, route-aware. Each
 * carries its index into the shared `timeline` state machine so the component
 * can mark done/current/upcoming consistently with the polling state — Receive
 * (Sepolia→Miden) never reaches the Sepolia claim steps, so they're dropped
 * from that direction rather than shown as dead nodes.
 */
function milestonesFor(activity: Activity) {
  const asset = destinationAssetSymbol(activity);
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
  if (activity.provider === "xreserve") {
    steps = [
      { status: "signature", label: "Sign USDC deposit", detail: "Approve USDC and confirm the deposit in your origin wallet." },
      { status: "source_finality", label: "Circle confirmation and attestation", detail: "Circle forwards your USDC to xReserve and attests the Miden deposit." },
      { status: "message_observed", label: "Delivering USDCx on Miden", detail: "Circle attested the deposit. The relayer is creating your USDCx note." },
      { status: "complete", label: "USDCx note delivered", detail: "The exact note is included on Miden. Consume it in Bread to update your balance." },
    ];
  } else if (isEpoch) {
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
              `A solver picked up your intent and is delivering ${asset} to your Miden account.`,
          },
          {
            status: "complete",
            label: "Delivered on Miden",
            detail: `${asset} is in your Miden account.`,
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
              `A solver claimed your note and is paying out ${asset} on Sepolia.`,
          },
          {
            status: "complete",
            label: "Settled on Sepolia",
            detail: `${asset} delivered to your Sepolia address.`,
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
  if (activity.provider === "xreserve" && activity.status !== "complete") {
    if (activity.xreserveStatus === "cancelled") return {
      headline: "Deposit cancelled in your wallet",
      body: "A cancellation replaced this deposit on the source chain. No USDC was bridged by this deposit; the cancellation transaction fee may still apply.",
    };
    if (activity.xreserveStatus === "replaced") return {
      headline: "Deposit replaced by another transaction",
      body: "Your wallet replaced this deposit with a different operation. Check the replacement transaction in the explorer before starting another transfer.",
    };
    if (activity.status === "failed") return {
      headline: "Deposit reverted",
      body: "The source deposit reverted. No USDC was bridged; the network transaction fee may still apply.",
    };
    if (activity.xreserveStatus === "attested") return {
      headline: "Circle attested — waiting for Miden delivery",
      body: "The USDCx note has not been confirmed on Miden yet. Tracking will continue; do not submit this deposit again.",
    };
    return {
      headline: activity.xreserveStatus === "confirmed" ? "Waiting for Circle attestation" : activity.xreserveForwarding ? "Circle is forwarding your USDC" : "Waiting for deposit confirmation",
      body: "Your deposit is saved. You can leave and return to this receipt to resume tracking.",
    };
  }
  const asset = destinationAssetSymbol(activity);
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
            ? `A solver picked up your intent and is delivering ${asset} to your Miden account.`
            : `A solver claimed your note and is paying out ${asset} on your Sepolia address.`,
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
      // Epoch delivers the output token directly; Agglayer delivers a note to consume.
      return isEpoch
        ? {
            headline: "Delivered on Miden",
            body: `The ${asset} is in your Miden account.`,
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
  // The replacement's outcome is explained above; do not suggest blindly
  // repeating a transfer when the wallet submitted a different operation.
  if (activity.provider === "xreserve" &&
      (activity.xreserveStatus === "cancelled" || activity.xreserveStatus === "replaced")) return null;
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
    // is intent-based: the solver delivers the output token directly, nothing to claim.
    const delivered =
      activity.status === "complete" || activity.status === "claim_available";
    if (delivered && (activity.provider === "agglayer" || activity.provider === "xreserve")) {
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
  const { activity, monitorError, lastCheckedAt, refresh } = useActivityTracking(id);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const quote = useMemo(
    () =>
      activity
        ? quoteForActivity(activity)
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
      ? activity.xreserveNoteId ?? activity.midenTxId ?? activity.destinationTxHash
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
    (destinationHash && activity?.provider !== "xreserve" ? activity?.updatedAt : undefined);

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
            receivedAmount={activity.receivedAmount ?? quote.expectedReceived}
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
                  Epoch's solver delivers the output token directly, so no consume step. */}
              {activity.mode === "receive" && (activity.provider === "agglayer" || activity.provider === "xreserve") ? (
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

          {activity.provider === "xreserve" ? (
            <div className="support-row">
              {isActive ? <button type="button" className="secondary-button" onClick={refresh}>Refresh status</button> : null}
              {activity.xreserveMidenBlock !== undefined ? <p>USDCx note included in Miden block {activity.xreserveMidenBlock}.</p> : null}
              {isActive && now - activityStartedAt(activity) > 15 * 60_000 ? <p>Still waiting for delivery. Keep this transaction hash; do not deposit again.</p> : null}
            </div>
          ) : null}

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
