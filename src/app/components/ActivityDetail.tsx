"use client";

import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
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
} from "../lib/bridge-monitor";
import {
  type Activity,
  type ExplorerLink,
  loadStoredActivities,
  modes,
  providers,
  quoteFor,
  saveActivities,
  sourceExplorer,
  statusLabel,
  statusTone,
  destinationExplorer,
  timeline,
} from "../lib/bridge-state";
import { epochActivityStatus, epochDestinationTx } from "../lib/epoch/epoch-status";
import { MIDEN_DESTINATION_CHAIN_ID } from "../lib/epoch/config";
import { sepoliaGasUnitsFor, useSepoliaGasEstimate } from "../lib/sepolia-gas";
import { formatAgo } from "../lib/relative-time";

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
 * Explorer link that only becomes clickable once its transaction exists. Before
 * that (e.g. a Send's Sepolia payout, a Receive's Miden delivery) it renders as
 * a disabled control so users don't follow a link to a not-yet-created tx.
 */
function ExplorerLinkButton({ link }: { link: ExplorerLink }) {
  if (link.available && link.href) {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="noreferrer"
        className="receipt-link"
      >
        {link.label}
        <ExternalLink size={14} aria-hidden="true" />
      </a>
    );
  }
  return (
    <span
      className="receipt-link disabled"
      aria-disabled="true"
      title="Available once the transaction is created"
    >
      {link.label}
      <ExternalLink size={14} aria-hidden="true" />
    </span>
  );
}

export function ActivityDetail({ id }: { id: string }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [monitorError, setMonitorError] = useState("");
  // Epoch-ms of the last monitor read; rendered as a live "updated Ns ago" that
  // ticks each second so the page visibly reflects the ≤10s polling cadence.
  const [lastCheckedAt, setLastCheckedAt] = useState(0);
  const [now, setNow] = useState(0);
  const activity = activities.find((item) => item.id === id);
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
              return { ...item, ...withTx, status: nextStatus, updatedAt: Date.now() };
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
  const modeCopy = activity ? modes[activity.mode] : null;
  const sourceLink = activity ? sourceExplorer(activity) : null;
  const destinationLink = activity ? destinationExplorer(activity) : null;
  // Compact live progress: which timeline step we're on, so the detail page
  // still monitors and shows status as the transfer advances.
  const currentIndex = activity
    ? timeline.findIndex((step) => step.status === activity.status)
    : -1;
  const isComplete = activity?.status === "complete";
  const isFailed = activity?.status === "failed";
  const currentStep = !activity
    ? null
    : isComplete
      ? timeline[timeline.length - 1]
      : (timeline[currentIndex] ?? timeline[0]);
  const receiptAmountLabel =
    activity?.status === "complete"
      ? activity.mode === "receive"
        ? "Delivered on Miden"
        : "Released on Sepolia"
      : activity?.mode === "receive"
        ? "Expected on Miden"
        : "Expected on Sepolia";
  const nextAction =
    activity?.status === "signature"
      ? "Confirm the source transaction in your wallet."
      : activity?.status === "source_finality"
        ? "Wait for source-chain confirmation and bridge finality."
        : activity?.status === "message_observed"
          ? activity.mode === "receive"
            ? "Wait for Agglayer to create the note on Miden."
            : "Wait for the destination claim to become available."
          : activity?.status === "claim_available"
            ? activity.mode === "receive"
              ? "Delivered to Miden — open your Bread wallet → Activities → Claim pending notes to reflect the balance."
              : "Claim funds on the destination side."
            : activity?.status === "claim_submitted"
              ? "Wait for the Sepolia claim transaction to confirm."
              : activity?.status === "failed"
                ? "This transfer needs a retry."
                : activity?.status === "complete" && activity.mode === "receive"
                  ? "Delivered to Miden. The bridge created the note on Miden; it won't show in your balance until you claim it. Open your Bread wallet → Activities → Claim pending notes to consume the note and move the funds into your balance."
                  : "Funds are available in the destination account.";

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
    setNow(Date.now());
    if (!isActive) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [isActive]);

  const lastCheckedLabel =
    lastCheckedAt && now ? formatAgo(Math.max(0, now - lastCheckedAt)) : "";

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
        <Link className="back-link" href="/">
          <ArrowLeft size={17} aria-hidden="true" />
          New transfer
        </Link>
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
        <section className="detail-simple">
          <div className="receipt-card">
            <div className="receipt-topline">
              <p className="kicker">
                {activity.mode === "send" ? "Send" : "Receive"} ·{" "}
                {providers[activity.provider].label}
              </p>
              <span className={`status-badge ${statusTone(activity.status)}`}>
                {statusLabel(activity.status)}
              </span>
            </div>

            <div className="receipt-amount">
              <span>{receiptAmountLabel}</span>
              <strong>{quote.expectedReceived}</strong>
            </div>

            <div className="receipt-route">
              <div>
                <span>From</span>
                <strong>{modeCopy?.from}</strong>
              </div>
              <ArrowRight size={16} aria-hidden="true" />
              <div>
                <span>To</span>
                <strong>{modeCopy?.to}</strong>
              </div>
            </div>

            <div
              className={`receipt-progress ${isFailed ? "failed" : isComplete ? "complete" : ""}`}
              aria-live="polite"
            >
              <div className="progress-track">
                {timeline.map((step, index) => (
                  <span
                    key={step.status}
                    className={`progress-seg ${
                      isComplete || index < currentIndex
                        ? "done"
                        : index === currentIndex
                          ? "current"
                          : ""
                    }`}
                  />
                ))}
              </div>
              <div className="progress-label">
                <strong>
                  {isFailed ? "Transfer needs a retry" : currentStep?.label}
                </strong>
                <span>
                  {isComplete
                    ? "Settled"
                    : isFailed
                      ? activity.eta
                      : lastCheckedLabel
                        ? `Monitoring · updated ${lastCheckedLabel}`
                        : "Monitoring…"}
                </span>
              </div>
            </div>

            <div className="receipt-lines">
              <ReceiptLine label="ETA" value={activity.eta} />
              <ReceiptLine
                label={activity.receivedAmount ? "Received" : "Min received"}
                value={activity.receivedAmount ?? quote.minReceived}
              />
              <ReceiptLine label="Network fee" value={networkFeeDisplay} />
            </div>

            {sourceLink || destinationLink ? (
              <div className="receipt-links">
                {sourceLink ? <ExplorerLinkButton link={sourceLink} /> : null}
                {destinationLink ? (
                  <ExplorerLinkButton link={destinationLink} />
                ) : null}
              </div>
            ) : null}

            {monitorError ? (
              <p className="form-error compact">{monitorError}</p>
            ) : null}

            <p className="receipt-monitor">
              {nextAction}
              {lastCheckedLabel ? ` · Last checked ${lastCheckedLabel}` : ""}
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

function ReceiptLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="receipt-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
