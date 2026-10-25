"use client";

import { useEffect, useState } from "react";
import { directionFor } from "../../bridge/providers/registry";
import { observeActivity } from "../../bridge/tracking";
import { useActivitySnapshot, useActivityStore } from "../components/ActivityProvider";
import { DEMO_ACTIVITIES } from "./activity-demo";
import { useBridgeEnvironment } from "../components/NetworkProvider";
import { errorMessage } from "./wallet-errors";

/** Polling owns observation timing; the shared store owns receipt state. */
export function useActivityTracking(id: string) {
  const environment = useBridgeEnvironment();
  const store = useActivityStore();
  const { ready, receipts } = useActivitySnapshot();
  const demo = environment === "testnet" ? DEMO_ACTIVITIES[id] : undefined;
  const receipt = receipts.find(item => item.activity.id === id && item.activity.environment === environment);
  const [view, setView] = useState<{
    id: string;
    monitorError: string;
    lastCheckedAt: number;
  }>({
    id,
    monitorError: "",
    lastCheckedAt: 0,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!ready || demo) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let delay = 3_000;
      try {
        const current = store.get(id)?.activity;
        if (controller.signal.aborted || !current || current.environment !== environment) return;
        delay = directionFor(current).pollMs;
        const observation = await observeActivity(current, controller.signal);
        if (controller.signal.aborted) return;
        if (observation) {
          // Patch the newest receipt, never the snapshot captured before the request.
          store.patch(id, observation.patch);
          setView({
            id,
            monitorError: observation.warning ?? "",
            lastCheckedAt: Date.now(),
          });
        } else
          delay =
            current.status === "complete" ||
            current.status === "failed" ||
            directionFor(current).tracking === "manual"
              ? 30_000
              : 3_000;
      } catch (error) {
        if (!controller.signal.aborted)
          setView((previous) => ({
            ...(previous.id === id ? previous : { lastCheckedAt: 0 }),
            id,
            monitorError: errorMessage(error),
          }));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, delay);
      }
    }
    queueMicrotask(() => {
      void poll();
    });
    const refresh = () => setVersion((value) => value + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id, version, environment, store, ready, demo]);

  const current = view.id === id;
  return {
    activity: demo ?? receipt?.activity,
    receiptSaved: Boolean(demo) || (receipt !== undefined && !receipt.unsavedChanges),
    isLoading: !demo && !ready,
    monitorError: current ? view.monitorError : "",
    lastCheckedAt: current ? view.lastCheckedAt : 0,
    refresh: () => setVersion((value) => value + 1),
  };
}
