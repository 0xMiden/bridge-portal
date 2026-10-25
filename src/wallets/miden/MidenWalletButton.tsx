"use client";

import { ChevronDown, Copy, LogOut, RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { midenWalletIdentity, shortAddress } from "../identity";
import { WalletMenu } from "../WalletMenu";
import { WalletBrandIcon } from "../WalletBrandIcon";
import { useMidenWallet } from "./useMidenWallet";

export function MidenWalletButton() {
  const wallet = useMidenWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    if (!menuOpen) return;
    function closeMenu(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  function invoke(action: () => void | Promise<void>) {
    setMenuOpen(false);
    setCopyError("");
    void action();
  }

  async function copyMidenAddress() {
    if (!wallet.address) return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopyError("Could not copy the Miden account from this browser.");
    }
  }

  // One source of truth for the pill's chain-specific label + accessible name.
  const identity = midenWalletIdentity({
    connecting: wallet.connecting,
    connected: wallet.connected,
    ready: wallet.ready,
    address: wallet.address,
  });

  return (
    <div className="wallet-menu-root" ref={menuRef}>
      <button
        className={`wallet-button wallet-pill ${wallet.connected ? "connected" : ""} ${identity.state === "unavailable" ? "unavailable" : ""}`}
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={identity.actionLabel}
      >
        <WalletBrandIcon src={wallet.logo} size={18} />
        <span className="wallet-pill-label">{identity.state === "idle" ? "Connect wallet" : identity.pillLabel}</span>
        <ChevronDown
          className="wallet-menu-chevron"
          size={15}
          aria-hidden="true"
        />
      </button>

      <WalletMenu
        open={menuOpen}
        avatar={
          <span
            className={`wallet-menu-avatar ${wallet.connected ? "connected" : wallet.connecting ? "pending" : ""}`}
          >
            <WalletBrandIcon src={wallet.logo} size={20} />
          </span>
        }
        name="Bread wallet"
        subtitle={
          wallet.connected
            ? `${shortAddress(wallet.address)} · ${wallet.balanceText}`
            : wallet.connecting
              ? "Connection pending"
              : wallet.ready
                ? "Ready to connect"
                : "Wallet extension not detected"
        }
      >
        {copyError ? <p className="wallet-menu-note" role="alert">{copyError}</p> : null}
        {wallet.connected ? (
            <>
              <p className="wallet-menu-note">
                Note sync: {wallet.noteSyncStatus}. Note consume remains
                wallet-confirmed.
              </p>
              <button
                type="button"
                role="menuitem"
                className="wallet-menu-item"
                onClick={wallet.refresh}
              >
                <RefreshCcw size={15} aria-hidden="true" />
                <span>Sync wallet state</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="wallet-menu-item"
                onClick={() => invoke(wallet.reconnect)}
              >
                <RefreshCcw size={15} aria-hidden="true" />
                <span>Reconnect wallet</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="wallet-menu-item"
                onClick={copyMidenAddress}
              >
                <Copy size={15} aria-hidden="true" />
                <span>{copied ? "Copied" : "Copy account"}</span>
              </button>
              <span className="wallet-menu-separator" />
              <button
                type="button"
                role="menuitem"
                className="wallet-menu-item danger"
                onClick={() => invoke(wallet.disconnect)}
              >
                <LogOut size={15} aria-hidden="true" />
                <span>Disconnect</span>
              </button>
            </>
          ) : (
            <>
              {wallet.connecting ? (
                <p className="wallet-menu-note">
                  Waiting for the wallet response. If the popup is gone, reset
                  the connection and try again.
                </p>
              ) : null}
              {!wallet.connecting && !wallet.ready ? (
                <p className="wallet-menu-note">
                  Install or enable the Bread wallet extension, then reset the
                  wallet state.
                </p>
              ) : null}
              {!wallet.connecting && wallet.ready ? (
                <button
                  type="button"
                  role="menuitem"
                  className="wallet-menu-item"
                  onClick={() => invoke(wallet.connect)}
                >
                  <WalletBrandIcon src={wallet.logo} size={15} />
                  <span>Connect wallet</span>
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="wallet-menu-item"
                onClick={() => invoke(wallet.reset)}
              >
                <RefreshCcw size={15} aria-hidden="true" />
                <span>
                  {wallet.connecting
                    ? "Reset connection"
                    : "Reset wallet state"}
                </span>
              </button>
            </>
          )}
      </WalletMenu>
    </div>
  );
}
