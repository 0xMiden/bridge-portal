"use client";

import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { ArrowUpRight, Check, Droplets, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { type EvmProvider } from "../lib/evm-wallet";
import {
  EPOCH_DASHBOARD_FAUCET_URL,
  FAUCET_MINT_AMOUNT,
  SEPOLIA_ETH_FAUCET_URL,
  mintSepoliaUsdc,
  sepoliaTxUrl,
} from "../lib/faucet";

type MintStatus =
  | { kind: "idle" }
  | { kind: "minting" }
  | { kind: "done"; hash: string }
  | { kind: "error"; message: string };

/**
 * Header popover for one-click testnet funding. Mints Epoch's Sepolia USDC mock
 * ERC20 straight from the connected wallet (the one asset that bootstraps every
 * route); the non-mintable assets — gas ETH and the dashboard-only Miden faucets
 * — are external links.
 */
export function FaucetMenu({ onMinted }: { onMinted?: () => void }) {
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<EvmProvider>("eip155");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<MintStatus>({ kind: "idle" });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const canMint = isConnected && !!address && !!walletProvider;

  const handleMint = async () => {
    if (!canMint || status.kind === "minting") return;
    setStatus({ kind: "minting" });
    try {
      const hash = await mintSepoliaUsdc({
        provider: walletProvider,
        account: address,
      });
      setStatus({ kind: "done", hash });
      onMinted?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Mint failed. Try again.";
      // User-rejected in the wallet reads back to idle rather than as an error.
      const rejected = /reject|denied|4001/i.test(message);
      setStatus(rejected ? { kind: "idle" } : { kind: "error", message });
    }
  };

  return (
    <div className="faucet-menu-root" ref={rootRef}>
      <button
        ref={triggerRef}
        className="faucet-trigger"
        type="button"
        aria-label="Get testnet funds"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <Droplets size={18} aria-hidden="true" />
      </button>

      {open ? (
        <div className="faucet-menu" id={menuId} role="menu" aria-label="Testnet faucet">
          <p className="faucet-menu-title">Get testnet funds</p>

          <div className="faucet-row">
            <span className="faucet-row-info">
              <strong>Sepolia USDC</strong>
              <small>Mints {FAUCET_MINT_AMOUNT} to your wallet</small>
            </span>
            <button
              className="faucet-mint-btn"
              type="button"
              onClick={handleMint}
              disabled={!canMint || status.kind === "minting"}
              title={canMint ? undefined : "Connect your Sepolia wallet first"}
            >
              {status.kind === "minting" ? (
                <>
                  <Loader2 size={13} className="faucet-spin" aria-hidden="true" />
                  Minting
                </>
              ) : status.kind === "done" ? (
                <>
                  <Check size={14} aria-hidden="true" />
                  Minted
                </>
              ) : (
                `Mint ${FAUCET_MINT_AMOUNT}`
              )}
            </button>
          </div>

          {status.kind === "done" ? (
            <a
              className="faucet-note faucet-note-link"
              href={sepoliaTxUrl(status.hash)}
              target="_blank"
              rel="noopener noreferrer"
            >
              View mint transaction
              <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          ) : null}
          {status.kind === "error" ? (
            <p className="faucet-note faucet-note-error">{status.message}</p>
          ) : null}

          <div className="faucet-links">
            <a
              className="faucet-link"
              href={SEPOLIA_ETH_FAUCET_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Sepolia ETH (gas)
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
            <a
              className="faucet-link"
              href={EPOCH_DASHBOARD_FAUCET_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Miden USDC / ETH
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
