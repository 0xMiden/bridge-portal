"use client";

import { useCallback, useEffect, useState } from "react";
import { shortAddress } from "../../wallets/identity";
import { SEPOLIA_NETWORK } from "../../config/sepolia";
import { stampLegTimes } from "../../bridge/core/rules";
import type { AgglayerDepositStatus } from "../../bridge/providers/agglayer/agglayer";
import { findMidenToEvmDeposit } from "../../bridge/providers/agglayer/agglayer-status";
import { epochActivityStatus, epochDestinationTx } from "../../bridge/providers/epoch/epoch-status";
import { MIDEN_DESTINATION_CHAIN_ID } from "../../bridge/providers/epoch/config";
import {
  agglayerPollMs,
  type BridgeMonitorObservation,
  type ChainTxObservation,
  deriveMonitoredActivity,
  sourceTxPollMs,
} from "./bridge-monitor";
import type { Activity } from "./bridge-presentation";
import { loadStoredActivities, saveActivities } from "./bridge-persistence";
import { DEMO_ACTIVITIES } from "./activity-demo";

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
  const response = await fetch(`/api/evm/sepolia/transaction?hash=${hash}`, {
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

/** Restore an activity and keep its persisted state in sync with both chains. */
export function useActivityTracking(id: string) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [monitorError, setMonitorError] = useState("");
  const [lastCheckedAt, setLastCheckedAt] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const activity = DEMO_ACTIVITIES[id] ?? activities.find((item) => item.id === id);

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

  useEffect(() => {
    if (activity?.provider !== "xreserve" || !activity.sourceTxHash || !isActive) return;
    const controller = new AbortController();
    const activityId = activity.id;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const { observeXreserveDeposit } = await import("../../bridge/providers/xreserve/status");
        const current = loadStoredActivities().find((item) => item.id === activityId);
        if (!current || controller.signal.aborted) return;
        const { patch, warning } = await observeXreserveDeposit(current, controller.signal);
        if (controller.signal.aborted) return;
        // Merge into the latest storage snapshot, preserving other transfers' updates.
        const updated = loadStoredActivities().map((item) => item.id === activityId
          ? { ...item, ...patch, ...(patch.sourceTxHash ? { txHash: shortAddress(patch.sourceTxHash) } : {}), updatedAt: Date.now() }
          : item);
        saveActivities(updated);
        setActivities(updated);
        setLastCheckedAt(Date.now());
        setMonitorError(warning ?? "");
      } catch (error) {
        if (!controller.signal.aborted) setMonitorError(errorMessage(error));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 12_000);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [activity?.id, activity?.provider, activity?.sourceTxHash, isActive, refreshVersion]);

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
      : SEPOLIA_NETWORK.chainId;

    (async () => {
      // epoch-execute pulls the eager-WASM Miden SDK; import lazily so it stays
      // out of SSR (as in bridge-submission).
      const { pollEpochIntentStatus } = await import("../../bridge/providers/epoch/epoch-execute");
      if (controller.signal.aborted) return;
      await pollEpochIntentStatus({
        sponsorAddress: sponsor,
        intentNonce: nonce,
        // Keep polling until the *destination* leg settles (Sepolia for a send)
        // — not just the Miden source leg — so the page advances to complete on
        // its own without a manual refresh.
        destinationChainId,
        signal: controller.signal,
        onUpdate: (statuses) => {
          if (controller.signal.aborted) return;
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
      if (cancelled) return;
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

  return { activity, monitorError, lastCheckedAt, refresh: () => setRefreshVersion((value) => value + 1) };
}
