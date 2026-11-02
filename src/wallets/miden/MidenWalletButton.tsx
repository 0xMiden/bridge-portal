"use client";

import { Menu, MenuTrigger } from "../../app/components/ui/Menu";

import { Copy, LogOut, RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { midenWalletIdentity } from "../identity";
import { WalletMenu, WalletMenuItem, WalletButton } from "../WalletMenu";
import { WalletBrandIcon } from "../WalletBrandIcon";
import { useMidenWallet } from "./useMidenWallet";

export function MidenWalletButton() {
  const wallet = useMidenWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

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
      <Menu open={menuOpen} onOpenChange={open => setMenuOpen(open)}>
      <MenuTrigger asChild>
      <WalletButton
        connected={wallet.connected}
        type="button"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={identity.actionLabel}
      >
        <WalletBrandIcon src={wallet.logo} size={18} />
        <span className="wallet-pill-label truncate">{identity.state === "idle" ? "Connect wallet" : identity.pillLabel}</span>
      </WalletButton>
      </MenuTrigger>

      <WalletMenu
        avatar={<WalletBrandIcon src={wallet.logo} size={20} />}
        state={wallet.connected ? "connected" : wallet.connecting ? "pending" : undefined}
        name="Bread wallet"
        subtitle={
          wallet.connected
            ? `${wallet.address} · ${wallet.balanceText}`
            : wallet.connecting
              ? "Connection pending"
              : wallet.ready
                ? "Ready to connect"
                : "Wallet extension not detected"
        }
      >
        {copyError ? <p className="m-2 text-xs text-muted-foreground" role="alert">{copyError}</p> : null}
        {wallet.connected ? (
            <>
              <p className="m-2 text-xs text-muted-foreground">
                Note sync: {wallet.noteSyncStatus}. Note consume remains
                wallet-confirmed.
              </p>
              <WalletMenuItem><button
                type="button"
                role="menuitem"
                onClick={wallet.refresh}
              >
                <RefreshCcw size={15} aria-hidden="true" />
                <span>Sync wallet state</span>
              </button></WalletMenuItem>
              <WalletMenuItem><button
                type="button"
                role="menuitem"
                onClick={() => invoke(wallet.reconnect)}
              >
                <RefreshCcw size={15} aria-hidden="true" />
                <span>Reconnect wallet</span>
              </button></WalletMenuItem>
              <WalletMenuItem><button
                type="button"
                role="menuitem"
                onClick={copyMidenAddress}
              >
                <Copy size={15} aria-hidden="true" />
                <span>{copied ? "Copied" : "Copy account"}</span>
              </button></WalletMenuItem>
              <span className="wallet-menu-separator bg-border h-px m-1" />
              <WalletMenuItem danger><button
                type="button"
                role="menuitem"
                onClick={() => invoke(wallet.disconnect)}
              >
                <LogOut size={15} aria-hidden="true" />
                <span>Disconnect</span>
              </button></WalletMenuItem>
            </>
          ) : (
            <>
              {wallet.connecting ? (
                <p className="m-2 text-xs text-muted-foreground">
                  Waiting for the wallet response. If the popup is gone, reset
                  the connection and try again.
                </p>
              ) : null}
              {!wallet.connecting && !wallet.ready ? (
                <p className="m-2 text-xs text-muted-foreground">
                  Install or enable the Bread wallet extension, then reset the
                  wallet state.
                </p>
              ) : null}
              {!wallet.connecting && wallet.ready ? (
                <WalletMenuItem><button
                  type="button"
                  role="menuitem"
                  onClick={() => invoke(wallet.connect)}
                >
                  <WalletBrandIcon src={wallet.logo} size={15} />
                  <span>Connect wallet</span>
                </button></WalletMenuItem>
              ) : null}
              <WalletMenuItem><button
                type="button"
                role="menuitem"
                onClick={() => invoke(wallet.reset)}
              >
                <RefreshCcw size={15} aria-hidden="true" />
                <span>
                  {wallet.connecting
                    ? "Reset connection"
                    : "Reset wallet state"}
                </span>
              </button></WalletMenuItem>
            </>
          )}
      </WalletMenu>
      </Menu>
  );
}
