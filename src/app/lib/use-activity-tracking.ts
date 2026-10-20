"use client";

import { useEffect, useState } from "react";
import type { Activity } from "../../bridge/core/models";
import { directionFor } from "../../bridge/providers/registry";
import { normalizeActivityState } from "../../bridge/activity";
import { observeActivity } from "../../bridge/tracking";
import { loadStoredActivities, patchStoredActivity } from "./bridge-persistence";
import { DEMO_ACTIVITIES } from "./activity-demo";
import { useBridgeEnvironment } from "../components/NetworkProvider";
import { errorMessage } from "./wallet-errors";

/** One polling lifecycle for every provider: read latest, observe, merge, publish. */
export function useActivityTracking(id: string) {
  const environment = useBridgeEnvironment();
  const [view, setView] = useState<{
    id: string;
    activity?: Activity;
    loaded: boolean;
    monitorError: string;
    lastCheckedAt: number;
  }>({
    id,
    loaded: false,
    monitorError: "",
    lastCheckedAt: 0,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const demo = environment === "testnet" ? DEMO_ACTIVITIES[id] : undefined;
    async function poll() {
      let delay = 3_000;
      try {
        const activity = demo ?? loadStoredActivities(environment).find((item) => item.id === id);
        if (controller.signal.aborted) return;
        const current = activity ? normalizeActivityState(activity) : undefined;
        setView((previous) => ({
          id,
          activity: current,
          loaded: true,
          monitorError: previous.id === id ? previous.monitorError : "",
          lastCheckedAt: previous.id === id ? previous.lastCheckedAt : 0,
        }));
        if (!current || demo) return;
        delay = directionFor(current).pollMs;
        const observation = await observeActivity(current, controller.signal);
        if (controller.signal.aborted) return;
        if (observation) {
          // Patch the newest persisted row, never the snapshot captured before the request.
          patchStoredActivity(id, observation.patch);
          const updated = loadStoredActivities(environment).find((item) => item.id === id);
          setView({
            id,
            activity: updated,
            loaded: true,
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
            ...(previous.id === id ? previous : { activity: undefined, lastCheckedAt: 0 }),
            id,
            loaded: true,
            monitorError: errorMessage(error),
          }));
      } finally {
        if (!controller.signal.aborted && !demo) timer = setTimeout(poll, delay);
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
  }, [id, version, environment]);

  const current = view.id === id;
  const demo = environment === "testnet" ? DEMO_ACTIVITIES[id] : undefined;
  return {
    activity: demo ?? (current ? view.activity : undefined),
    isLoading: !demo && (!current || !view.loaded),
    monitorError: current ? view.monitorError : "",
    lastCheckedAt: current ? view.lastCheckedAt : 0,
    refresh: () => setVersion((value) => value + 1),
  };
}
