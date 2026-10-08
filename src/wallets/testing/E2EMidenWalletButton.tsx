"use client";

import { useEffect, useState } from "react";
import { createE2EMidenSigner } from "./miden-signer";
import { publishE2E } from "./window-hook";
import { shortAddress } from "../identity";
import { MIDEN_USDC } from "../../bridge/core/assets";
import { midenBalanceKey } from "../../bridge/miden-balances";
import type { MidenWalletSnapshot } from "../miden/MidenWalletButton";
import { useBalanceStore } from "../../bridge/BalanceProvider";

// E2E stand-in for MidenWalletButton: builds a headless Miden signer (mock or
// real-testnet per E2E_NETWORK), pushes the same MidenWalletSnapshot the app
// consumes, and publishes the Miden leg of window.__E2E__. Same onStateChange
// contract as the real button, so BridgeExperience swaps it transparently.
export function E2EMidenWalletButton({
  onStateChange,
}: {
  onStateChange: (state: MidenWalletSnapshot) => void;
}) {
  const [address, setAddress] = useState("");
  const balances = useBalanceStore();

  useEffect(() => {
    let cancelled = false;
    onStateChange({
      address: "",
      connected: false,
      connecting: true,
      ready: true,
      error: "",
      balanceText: "Connecting",
      noteSyncStatus: "Connecting",
      consumableNoteCount: null,
    });

    (async () => {
      try {
        const signer = await createE2EMidenSigner();
        if (cancelled) return;
        balances.setMidenSession({
          account: signer.address,
          network: "miden-testnet",
          requestAssets: signer.requestAssets,
        });
        setAddress(signer.address);
        onStateChange({
          address: signer.address,
          connected: true,
          connecting: false,
          ready: true,
          error: "",
          balanceText: "Connected",
          noteSyncStatus: "Ready",
          consumableNoteCount: null,
          requestSend: signer.requestSend,
          requestTransaction: signer.requestTransaction,
          waitForTransaction: signer.waitForTransaction,
          requestConsumableNotes: signer.requestConsumableNotes,
        });
        publishE2E({
          midenAddress: signer.address,
          midenReady: true,
          // Real bridged-note detector for the round-trip settlement gate.
          midenConsumableCount: async () => {
            const notes = await signer.requestConsumableNotes();
            return Array.isArray(notes) ? notes.length : 0;
          },
          // Vault USDC balance — the signal for an auto-consumed Epoch receive.
          midenUsdcBalance: async () => {
            const snapshot = await balances.requestMiden(signer.address, "miden-testnet", true);
            return snapshot[midenBalanceKey(signer.address, MIDEN_USDC)]?.amountRaw.toString() ?? "0";
          },
        });
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "E2E Miden signer failed";
        onStateChange({
          address: "",
          connected: false,
          connecting: false,
          ready: true,
          error: message,
          balanceText: "Signer error",
          noteSyncStatus: "Error",
          consumableNoteCount: null,
        });
        // Still mark ready so the fixture doesn't hang forever on a bad seed;
        // the spec asserts on the error surface instead.
        publishE2E({ midenReady: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [balances, onStateChange]);

  return (
    <button
      className="wallet-button wallet-pill connected"
      type="button"
      data-e2e="miden-wallet"
      disabled
    >
      <span className="wallet-avatar">
        <span className="wallet-avatar-badge" />
      </span>
      <span className="wallet-pill-label">
        {address ? shortAddress(address) : "E2E Miden"}
      </span>
    </button>
  );
}
