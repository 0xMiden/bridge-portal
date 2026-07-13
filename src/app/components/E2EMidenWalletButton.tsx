"use client";

import { useEffect, useState } from "react";
import { createE2EMidenSigner } from "../lib/e2e/miden-signer";
import { publishE2E } from "../lib/e2e/window-hook";
import { shortAddress } from "../lib/bridge-state";
import type { MidenWalletSnapshot } from "./MidenWalletButton";

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

  useEffect(() => {
    let cancelled = false;
    onStateChange({
      address: "",
      connected: false,
      error: "",
      balanceText: "Connecting",
      noteSyncStatus: "Connecting",
      consumableNoteCount: null,
    });

    (async () => {
      try {
        const signer = await createE2EMidenSigner();
        if (cancelled) return;
        setAddress(signer.address);
        onStateChange({
          address: signer.address,
          connected: true,
          error: "",
          balanceText: "Connected",
          noteSyncStatus: "Ready",
          consumableNoteCount: null,
          requestSend: signer.requestSend,
          requestTransaction: signer.requestTransaction,
          waitForTransaction: signer.waitForTransaction,
          requestAssets: signer.requestAssets,
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
            const assets = (await signer.requestAssets()) as unknown as Array<{
              faucetId?: string;
              amount?: string | number;
            }>;
            const usdc = "0xfc90f0f4da30e51168453b60eafed7"; // Miden USDC faucet
            const total = (Array.isArray(assets) ? assets : []).reduce(
              (sum, a) =>
                (a.faucetId ?? "").toLowerCase().includes("fc90f0f4")
                  ? sum + BigInt(a.amount ?? 0)
                  : sum,
              0n,
            );
            void usdc;
            return total.toString();
          },
        });
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "E2E Miden signer failed";
        onStateChange({
          address: "",
          connected: false,
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
  }, [onStateChange]);

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
