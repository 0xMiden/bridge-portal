"use client";

import {
  AllowedPrivateData,
  PrivateDataPermission,
  WalletAdapterNetwork,
  WalletReadyState,
} from "@miden-sdk/miden-wallet-adapter-base";
import {
  type MidenFiWalletContextState,
  MidenFiSignerProvider,
  useMidenFiWallet,
} from "@miden-sdk/miden-wallet-adapter-react";
import {
  ChevronDown,
  Copy,
  LogOut,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { shortAddress } from "../lib/bridge-state";

type MidenWalletSnapshot = {
  address: string;
  connected: boolean;
  error: string;
  balanceText: string;
  noteSyncStatus: string;
  consumableNoteCount: number | null;
  /**
   * Miden write primitives surfaced upward so the (SSR'd) BridgeExperience can
   * run an Epoch Miden→EVM send without importing the eager-WASM adapter itself.
   * Undefined until the MidenFi adapter connects.
   */
  requestSend?: MidenFiWalletContextState["requestSend"];
  // requestTransaction submits a custom (pre-built) TransactionRequest — the
  // AggLayer B2AGG bridge-out note goes through this, not requestSend.
  requestTransaction?: MidenFiWalletContextState["requestTransaction"];
  waitForTransaction?: MidenFiWalletContextState["waitForTransaction"];
  // requestAssets reads the wallet's (private) token balances — opens a popup.
  requestAssets?: MidenFiWalletContextState["requestAssets"];
};

type MidenWalletButtonProps = {
  onStateChange: (state: MidenWalletSnapshot) => void;
};

type MidenWalletButtonInnerProps = MidenWalletButtonProps & {
  onResetProvider: () => void;
};

const walletRequestTimeoutMs = 45_000;

class WalletRequestTimeoutError extends Error {
  constructor() {
    super(
      "Miden wallet did not return after 45 seconds. Reset the connection and try again.",
    );
    this.name = "WalletRequestTimeoutError";
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error)
    return String(error.message);
  return "Something went wrong. Try again.";
}

function withWalletTimeout<T>(request: Promise<T>) {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new WalletRequestTimeoutError()),
      walletRequestTimeoutMs,
    );
  });

  return Promise.race([request, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

function MidenWalletButtonInner({
  onResetProvider,
  onStateChange,
}: MidenWalletButtonInnerProps) {
  const wallet = useMidenFiWallet();
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [balanceText, setBalanceText] = useState("Not connected");
  const [noteSyncStatus, setNoteSyncStatus] = useState("Not connected");
  const [consumableNoteCount, setConsumableNoteCount] = useState<number | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);
  // In-flight guard: requestAssets()/requestConsumableNotes() each open a MidenFi
  // confirmation popup. Without dedup, concurrent callers (React StrictMode's
  // double-invoked mount effect, or rapid address/connected changes) stack
  // multiple popups that never seem to dismiss. Collapse concurrent refreshes
  // to a single in-flight promise.
  const refreshInflightRef = useRef<Promise<void> | null>(null);
  const address = wallet.address ?? "";
  const readyState = wallet.wallet?.readyState;
  const ready =
    readyState === WalletReadyState.Installed ||
    readyState === WalletReadyState.Loadable;

  useEffect(() => {
    if (wallet.wallet || wallet.wallets.length === 0) return;
    wallet.select(wallet.wallets[0].adapter.name);
  }, [wallet]);

  useEffect(() => {
    onStateChange({
      address,
      connected: wallet.connected,
      error,
      balanceText,
      noteSyncStatus,
      consumableNoteCount,
      requestSend: wallet.requestSend,
      requestTransaction: wallet.requestTransaction,
      waitForTransaction: wallet.waitForTransaction,
      requestAssets: wallet.requestAssets,
    });
  }, [
    address,
    balanceText,
    consumableNoteCount,
    error,
    noteSyncStatus,
    onStateChange,
    wallet.connected,
    wallet.requestSend,
    wallet.requestTransaction,
    wallet.waitForTransaction,
    wallet.requestAssets,
  ]);

  useEffect(() => {
    if (!wallet.connected) {
      queueMicrotask(() => {
        setBalanceText("Not connected");
        setNoteSyncStatus("Not connected");
        setConsumableNoteCount(null);
      });
      return;
    }

    // Do NOT eagerly call requestAssets()/requestConsumableNotes() on connect —
    // each opens a MidenFi confirmation popup the bridge flow doesn't need, and
    // they pile up. Balance/notes are fetched on demand via the menu's refresh
    // button (onClick={refreshWalletState}). Show a neutral connected state here.
    queueMicrotask(() => {
      setBalanceText("Connected");
      setNoteSyncStatus("Refresh to sync");
    });
  }, [wallet.connected, address]);

  useEffect(() => {
    if (!menuOpen) return;

    function closeMenu(event: MouseEvent | PointerEvent) {
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

  async function connectMidenWallet() {
    setError("");
    setMenuOpen(false);
    if (!ready) {
      setError(
        "Install or enable the MidenFi wallet extension, then refresh this page.",
      );
      return;
    }

    try {
      await withWalletTimeout(wallet.connect());
    } catch (connectError) {
      setError(errorMessage(connectError));
      if (connectError instanceof WalletRequestTimeoutError) {
        window.setTimeout(onResetProvider, 250);
      }
    }
  }

  async function reconnectMidenWallet() {
    setError("");
    try {
      if (wallet.connected) await wallet.disconnect();
      await withWalletTimeout(wallet.connect());
      setMenuOpen(false);
    } catch (reconnectError) {
      setError(errorMessage(reconnectError));
      if (reconnectError instanceof WalletRequestTimeoutError) {
        window.setTimeout(onResetProvider, 250);
      }
    }
  }

  async function disconnectMidenWallet() {
    setError("");
    try {
      await wallet.disconnect();
      setMenuOpen(false);
    } catch (disconnectError) {
      setError(errorMessage(disconnectError));
    }
  }

  async function copyMidenAddress() {
    if (!address) return;

    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setError("Could not copy the Miden account from this browser.");
    }
  }

  async function refreshWalletState() {
    if (!wallet.connected) return;
    // Collapse concurrent/repeated refreshes into one popup cycle.
    if (refreshInflightRef.current) return refreshInflightRef.current;
    const run = doRefreshWalletState();
    refreshInflightRef.current = run;
    try {
      await run;
    } finally {
      if (refreshInflightRef.current === run) refreshInflightRef.current = null;
    }
  }

  async function doRefreshWalletState() {
    setError("");
    setBalanceText("Syncing assets");
    setNoteSyncStatus("Syncing notes");

    try {
      const assets = wallet.requestAssets ? await wallet.requestAssets() : [];
      const assetCount = Array.isArray(assets) ? assets.length : 0;
      const firstAsset = Array.isArray(assets)
        ? (assets[0] as { amount?: string | number } | undefined)
        : undefined;
      setBalanceText(
        assetCount === 0
          ? "No wallet assets"
          : firstAsset?.amount
            ? `${assetCount} asset${assetCount === 1 ? "" : "s"} · ${firstAsset.amount}`
            : `${assetCount} wallet asset${assetCount === 1 ? "" : "s"}`,
      );
    } catch (assetError) {
      setBalanceText("Balance sync unavailable");
      setError(errorMessage(assetError));
    }

    try {
      const notes = wallet.requestConsumableNotes
        ? await wallet.requestConsumableNotes()
        : [];
      const count = Array.isArray(notes) ? notes.length : 0;
      setConsumableNoteCount(count);
      setNoteSyncStatus(
        count > 0
          ? `${count} consumable note${count === 1 ? "" : "s"}`
          : "No consumable notes",
      );
    } catch {
      setConsumableNoteCount(null);
      setNoteSyncStatus("Note sync unavailable");
    }
  }

  function resetMidenConnection() {
    setError("");
    try {
      window.localStorage.removeItem("miden-bridge-wallet");
    } catch {
      // Ignore storage failures; remounting the provider still clears local UI state.
    }
    void wallet.disconnect().catch(() => undefined);
    setMenuOpen(false);
    onResetProvider();
  }

  return (
    <div className="wallet-menu-root" ref={menuRef}>
      <button
        className={`wallet-button wallet-pill ${wallet.connected ? "connected" : ""}`}
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        <span className={`wallet-icon ${wallet.connected ? "connected" : ""}`}>
          <ShieldCheck size={16} aria-hidden="true" />
        </span>
        <span className="wallet-copy">
          <small>
            <span
              className={`wallet-status-dot ${wallet.connected ? "connected" : wallet.connecting ? "pending" : ""}`}
            />
            Miden
          </small>
          <span>
            {wallet.connecting
              ? "Connecting"
              : wallet.connected
                ? shortAddress(address)
                : ready
                  ? "Connect wallet"
                  : "Install wallet"}
          </span>
        </span>
        {wallet.connected ? (
          <span className="wallet-balance">{balanceText}</span>
        ) : null}
        <ChevronDown
          className="wallet-menu-chevron"
          size={15}
          aria-hidden="true"
        />
      </button>

      {menuOpen ? (
        <div
          className={`wallet-actions-menu ${menuOpen ? "open" : ""}`}
          role="menu"
        >
          <div className="wallet-menu-summary">
            <span
              className={`wallet-menu-avatar ${wallet.connected ? "connected" : wallet.connecting ? "pending" : ""}`}
            >
              <ShieldCheck size={16} aria-hidden="true" />
            </span>
            <span>
              <strong>Miden wallet</strong>
              <small>
                {wallet.connected
                  ? `${shortAddress(address)} · ${balanceText}`
                  : wallet.connecting
                    ? "Connection pending"
                    : ready
                      ? "Ready to connect"
                      : "Wallet extension not detected"}
              </small>
            </span>
          </div>
          {wallet.connected ? (
            <>
              <p className="wallet-menu-note">
                Note sync: {noteSyncStatus}. Note consume remains
                wallet-confirmed.
              </p>
              <button
                type="button"
                role="menuitem"
                className="wallet-menu-item"
                onClick={refreshWalletState}
              >
                <RefreshCcw size={15} aria-hidden="true" />
                <span>Sync wallet state</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="wallet-menu-item"
                onClick={reconnectMidenWallet}
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
                onClick={disconnectMidenWallet}
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
              {!wallet.connecting && !ready ? (
                <p className="wallet-menu-note">
                  Install or enable the MidenFi wallet extension, then reset the
                  wallet state.
                </p>
              ) : null}
              {!wallet.connecting && ready ? (
                <button
                  type="button"
                  role="menuitem"
                  className="wallet-menu-item"
                  onClick={connectMidenWallet}
                >
                  <ShieldCheck size={15} aria-hidden="true" />
                  <span>Connect wallet</span>
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="wallet-menu-item"
                onClick={resetMidenConnection}
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
        </div>
      ) : null}
    </div>
  );
}

export function MidenWalletButton(props: MidenWalletButtonProps) {
  const [providerKey, setProviderKey] = useState(0);

  return (
    <MidenFiSignerProvider
      key={providerKey}
      appName="Miden Bridge"
      network={WalletAdapterNetwork.Testnet}
      autoConnect={false}
      privateDataPermission={PrivateDataPermission.UponRequest}
      allowedPrivateData={AllowedPrivateData.None}
      localStorageKey="miden-bridge-wallet"
    >
      <MidenWalletButtonInner
        {...props}
        onResetProvider={() => setProviderKey((key) => key + 1)}
      />
    </MidenFiSignerProvider>
  );
}
