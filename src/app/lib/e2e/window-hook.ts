"use client";

import { activityStorageKey } from "../bridge-state";

// The gated `window.__E2E__` surface — the analog of the wallet harness's
// `window.__TEST_STORE__`. Both injected signers publish into it; `ready` flips
// true once BOTH wallets have connected, which the Playwright fixture awaits
// before driving the form. Present only in E2E builds.
export type E2EWindowHook = {
  evmAddress?: string;
  midenAddress?: string;
  evmReady?: boolean;
  midenReady?: boolean;
  ready?: boolean;
  /** Read the persisted activity list (for harness state assertions). */
  readActivities: () => unknown[];
  /**
   * Count of consumable notes on the Miden account — the real on-chain artifact
   * of a settled bridge-in. The round-trip spec polls this to detect the actual
   * arrival (not a balance delta) before sending back.
   */
  midenConsumableCount?: () => Promise<number>;
};

declare global {
  interface Window {
    __E2E__?: E2EWindowHook;
  }
}

export function publishE2E(patch: Partial<E2EWindowHook>): void {
  if (typeof window === "undefined") return;
  const current: E2EWindowHook = window.__E2E__ ?? {
    readActivities: () => {
      try {
        const raw = window.localStorage.getItem(activityStorageKey);
        return raw ? (JSON.parse(raw) as unknown[]) : [];
      } catch {
        return [];
      }
    },
  };
  const next: E2EWindowHook = { ...current, ...patch };
  next.ready = Boolean(next.evmReady && next.midenReady);
  window.__E2E__ = next;
}
