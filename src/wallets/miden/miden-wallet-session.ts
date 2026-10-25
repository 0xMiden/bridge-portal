import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import type { BalanceStore } from "../../bridge/balance-store";
import { midenNetworks, type BridgeEnvironment } from "../../config/environment";
import { assertMidenAccountNetwork } from "./network";

/** The adapter boundary; the session never imports the eager-WASM SDK. */
export type MidenSessionWallet = Pick<MidenFiWalletContextState,
  "address" | "connected" | "connecting" | "connect" | "disconnect" |
  "requestAssets" | "requestSend" | "requestTransaction" |
  "waitForTransaction" | "requestConsumableNotes"
> & {
  ready: boolean;
  logo?: string;
  adapter: { readonly connected: boolean; readonly address: string | null } | null;
};

export type MidenWalletSnapshot = {
  address: string;
  connected: boolean;
  connecting: boolean;
  ready: boolean;
  logo?: string;
  error: string;
  noteSyncStatus: string;
  consumableNoteCount: number | null;
  requestSend?: MidenFiWalletContextState["requestSend"];
  requestTransaction?: MidenFiWalletContextState["requestTransaction"];
  waitForTransaction?: MidenFiWalletContextState["waitForTransaction"];
  requestConsumableNotes?: MidenFiWalletContextState["requestConsumableNotes"];
};

const emptySnapshot: MidenWalletSnapshot = {
  address: "", connected: false, connecting: false, ready: false, error: "",
  noteSyncStatus: "Not connected", consumableNoteCount: null,
};

export const midenWalletStorageKey = (environment: BridgeEnvironment) =>
  environment === "testnet" ? "miden-bridge-wallet" : "miden-bridge-wallet.mainnet";
const connectedKey = (environment: BridgeEnvironment) =>
  environment === "testnet" ? "miden-bridge-wallet-connected" : "miden-bridge-wallet-connected.mainnet";

function rememberConnection(environment: BridgeEnvironment, connected: boolean) {
  try {
    if (connected) localStorage.setItem(connectedKey(environment), "1");
    else localStorage.removeItem(connectedKey(environment));
  } catch { /* Storage is optional; the in-memory session still works. */ }
}

function wasConnected(environment: BridgeEnvironment) {
  try { return localStorage.getItem(connectedKey(environment)) === "1"; }
  catch { return false; }
}

function errorMessage(error: unknown) {
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "Something went wrong. Try again.";
}

class WalletRequestTimeoutError extends Error {
  constructor() {
    super("Bread wallet did not return after 45 seconds. Reset the connection and try again.");
  }
}

/** One owner for connection attempts, account-scoped reads, and signing guards. */
export class MidenWalletSession {
  private wallet: MidenSessionWallet | null = null;
  private snapshot = emptySnapshot;
  private listeners = new Set<() => void>();
  private version = 0;
  private restoreTried = false;
  private connection: { cancel: () => void; promise: Promise<void>; connecting: boolean } | null = null;
  private refreshInflight: Promise<void> | null = null;

  constructor(
    readonly environment: BridgeEnvironment,
    private readonly balances: BalanceStore,
    private readonly resetAdapter: () => void,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.snapshot;

  private publish(patch: Partial<MidenWalletSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }

  updateWallet(wallet: MidenSessionWallet) {
    const previous = this.wallet;
    // The SDK can render its old account while disconnect is in progress.
    const connected = wallet.connected && Boolean(wallet.address) &&
      Boolean(wallet.adapter?.connected) && wallet.adapter?.address === wallet.address &&
      this.connection?.connecting !== false;
    const changed = previous?.adapter !== wallet.adapter ||
      this.snapshot.address !== (wallet.address ?? "") || this.snapshot.connected !== connected;
    this.wallet = wallet;
    if (changed) {
      this.version++;
      this.refreshInflight = null;
    }
    let networkError = "";
    if (connected) {
      try { assertMidenAccountNetwork(wallet.address ?? "", this.environment); }
      catch (error) { networkError = errorMessage(error); }
    }
    const usable = connected && !networkError;
    this.balances.setMidenSession(usable ? {
      account: wallet.address!, network: midenNetworks[this.environment].network,
      requestAssets: wallet.requestAssets,
    } : null);
    const version = this.version;
    const guard = () => {
      if (!this.isCurrent(wallet, version)) {
        throw new Error("Your Miden wallet changed. Reconnect and review the transfer.");
      }
      assertMidenAccountNetwork(wallet.adapter!.address!, this.environment);
    };
    this.publish({
      address: wallet.address ?? "", connected, connecting: wallet.connecting || Boolean(this.connection?.connecting),
      ready: wallet.ready, logo: wallet.logo,
      error: networkError || (changed && previous?.connected ? "" : this.snapshot.error),
      ...(changed ? {
        noteSyncStatus: connected ? "Refresh to sync" : "Not connected",
        consumableNoteCount: null,
      } : {}),
      requestSend: usable && wallet.requestSend ? (...args) => { guard(); return wallet.requestSend!(...args); } : undefined,
      requestTransaction: usable && wallet.requestTransaction ? (...args) => { guard(); return wallet.requestTransaction!(...args); } : undefined,
      requestConsumableNotes: usable && wallet.requestConsumableNotes ? (...args) => { guard(); return wallet.requestConsumableNotes!(...args); } : undefined,
      // A submitted transaction can still be tracked after its account disconnects.
      waitForTransaction: usable ? wallet.waitForTransaction : undefined,
    });
    if (!this.restoreTried && wallet.ready && !wallet.connected && !wallet.connecting) {
      this.restoreTried = true;
      if (wasConnected(this.environment)) void this.connect();
    }
  }

  private isCurrent(wallet: MidenSessionWallet, version: number) {
    return wallet.connected && this.version === version && this.wallet?.adapter === wallet.adapter &&
      Boolean(wallet.adapter?.connected) && wallet.adapter?.address === wallet.address;
  }

  /** The deadline also covers disconnect during reconnect; reset cancels its timer. */
  private runConnection(work: (signal: AbortSignal) => Promise<void>, remember: boolean) {
    if (this.connection) return this.connection.promise;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new WalletRequestTimeoutError()), 45_000);
    });
    // Defer work until the operation is registered, including synchronous failures.
    const operation = {
      cancel: () => controller.abort(),
      connecting: remember,
      promise: Promise.race([Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return work(controller.signal);
      }), timeout, cancelled])
        .then(() => {
          if (!controller.signal.aborted) rememberConnection(this.environment, remember);
        })
        .catch(error => {
          if (controller.signal.aborted) return;
          rememberConnection(this.environment, false);
          if (error instanceof WalletRequestTimeoutError) this.reset(error.message);
          else this.publish({ error: errorMessage(error) });
        })
        .finally(() => {
          clearTimeout(timer);
          if (this.connection === operation) {
            this.connection = null;
            this.publish({ connecting: false });
          }
        }),
    };
    this.connection = operation;
    this.publish({ connecting: remember });
    return operation.promise;
  }

  connect = () => {
    const wallet = this.wallet;
    this.restoreTried = true;
    this.publish({ error: "" });
    if (!wallet?.ready) {
      this.publish({ error: "Install or enable the Bread wallet extension, then refresh this page." });
      return Promise.resolve();
    }
    return this.runConnection(() => wallet.connect(), true);
  };

  reconnect = () => {
    const wallet = this.wallet;
    if (!wallet) return this.connect();
    this.publish({ error: "" });
    return this.runConnection(async signal => {
      if (wallet.connected) await wallet.disconnect();
      // Reset/dispose can happen while disconnect is awaiting the extension.
      signal.throwIfAborted();
      await wallet.connect();
    }, true);
  };

  disconnect = () => {
    const wallet = this.wallet;
    this.cancelConnection();
    this.restoreTried = true;
    rememberConnection(this.environment, false);
    this.invalidate();
    return wallet ? this.runConnection(() => wallet.disconnect(), false) : Promise.resolve();
  };

  private cancelConnection() {
    this.connection?.cancel();
    this.connection = null;
  }

  private invalidate(error = "") {
    this.version++;
    this.wallet = null;
    this.refreshInflight = null;
    this.balances.setMidenSession(null);
    this.publish({ ...emptySnapshot, error });
  }

  reset = (error = "") => {
    const wallet = this.wallet;
    this.cancelConnection();
    this.restoreTried = true;
    rememberConnection(this.environment, false);
    try { localStorage.removeItem(midenWalletStorageKey(this.environment)); } catch { /* optional */ }
    this.invalidate(error);
    void wallet?.disconnect().catch(() => {});
    this.resetAdapter();
  };

  refresh = () => {
    if (this.refreshInflight) return this.refreshInflight;
    const wallet = this.wallet;
    const version = this.version;
    const requestNotes = this.snapshot.requestConsumableNotes;
    if (!wallet || !this.isCurrent(wallet, version)) return Promise.resolve();
    try { assertMidenAccountNetwork(wallet.address!, this.environment); }
    catch (error) { this.publish({ error: errorMessage(error) }); return Promise.resolve(); }
    this.publish({ error: "", noteSyncStatus: "Syncing notes", consumableNoteCount: null });
    const run = (async () => {
      try {
        await this.balances.requestMiden(wallet.address!, midenNetworks[this.environment].network, true);
      } catch (error) {
        if (this.isCurrent(wallet, version)) this.publish({ error: errorMessage(error) });
      }
      if (!this.isCurrent(wallet, version)) return;
      try {
        if (!requestNotes) throw new Error("Note sync unavailable");
        const notes = await requestNotes();
        if (!this.isCurrent(wallet, version)) return;
        const count = Array.isArray(notes) ? notes.length : 0;
        this.publish({ consumableNoteCount: count,
          noteSyncStatus: count ? `${count} consumable note${count === 1 ? "" : "s"}` : "No consumable notes" });
      } catch {
        if (this.isCurrent(wallet, version)) this.publish({ consumableNoteCount: null, noteSyncStatus: "Note sync unavailable" });
      }
    })().finally(() => { if (this.refreshInflight === run) this.refreshInflight = null; });
    this.refreshInflight = run;
    return run;
  };

  dispose() {
    this.cancelConnection();
    this.restoreTried = false;
    this.invalidate();
  }
}
