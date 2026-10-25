import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BalanceStore } from "../../bridge/balance-store";
import { MIDEN_ETH } from "../../bridge/core/assets";
import { MidenWalletSession, type MidenSessionWallet } from "./miden-wallet-session";

const ACCOUNT_A = "mtst1account-a";
const ACCOUNT_B = "mtst1account-b";
const CONNECTED_KEY = "miden-bridge-wallet-connected";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function wallet(connected = true, address = ACCOUNT_A) {
  const adapter = { connected, address: connected ? address : null };
  return {
    adapter, connected, address: adapter.address, connecting: false, ready: true,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    requestAssets: vi.fn<NonNullable<MidenSessionWallet["requestAssets"]>>(async () => []),
    requestTransaction: vi.fn<NonNullable<MidenSessionWallet["requestTransaction"]>>(),
    requestSend: vi.fn<NonNullable<MidenSessionWallet["requestSend"]>>(),
    requestConsumableNotes: vi.fn<NonNullable<MidenSessionWallet["requestConsumableNotes"]>>(async () => []),
  } satisfies MidenSessionWallet;
}

const sessions: MidenWalletSession[] = [];
const clients: QueryClient[] = [];
function setup(environment: "testnet" | "mainnet" = "testnet") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const balances = new BalanceStore(client);
  const resetAdapter = vi.fn();
  const session = new MidenWalletSession(environment, balances, resetAdapter);
  sessions.push(session);
  return { session, balances, resetAdapter };
}

beforeEach(() => {
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
});
afterEach(() => {
  sessions.splice(0).forEach(session => session.dispose());
  clients.splice(0).forEach(client => client.clear());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("root Miden wallet session", () => {
  it("restores once without a button subscriber and shares a pending connect", async () => {
    localStorage.setItem(CONNECTED_KEY, "1");
    const { session } = setup();
    const source = wallet(false);
    const pending = deferred<void>();
    source.connect.mockReturnValue(pending.promise);
    session.updateWallet(source);
    const manual = session.connect();
    expect(session.connect()).toBe(manual);
    await Promise.resolve();
    expect(source.connect).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().connecting).toBe(true);
    pending.resolve();
    await manual;
    session.updateWallet(source);
    expect(source.connect).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CONNECTED_KEY)).toBe("1");
  });

  it("ends a hung restore once and ignores its late success after adapter reset", async () => {
    localStorage.setItem(CONNECTED_KEY, "1");
    const { session, resetAdapter } = setup();
    const source = wallet(false);
    const pending = deferred<void>();
    source.connect.mockReturnValue(pending.promise);
    session.updateWallet(source);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(resetAdapter).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CONNECTED_KEY)).toBeNull();
    const replacement = wallet(false);
    session.updateWallet(replacement);
    expect(session.getSnapshot()).toMatchObject({ connected: false, connecting: false, error: expect.stringContaining("45 seconds") });
    pending.resolve();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(replacement.connect).not.toHaveBeenCalled();
    expect(resetAdapter).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CONNECTED_KEY)).toBeNull();
  });

  it("forgets a rejected restore but allows an explicit retry", async () => {
    localStorage.setItem(CONNECTED_KEY, "1");
    const { session } = setup();
    const source = wallet(false);
    source.connect.mockRejectedValueOnce(new Error("Rejected"));
    session.updateWallet(source);
    await session.connect();
    expect(localStorage.getItem(CONNECTED_KEY)).toBeNull();
    session.updateWallet(source);
    expect(source.connect).toHaveBeenCalledTimes(1);
    await session.connect();
    expect(source.connect).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().error).toBe("");
  });

  it("cancels a reconnect waiting on disconnect when the user resets", async () => {
    const { session } = setup();
    const source = wallet();
    const pending = deferred<void>();
    source.disconnect.mockReturnValue(pending.promise);
    session.updateWallet(source);
    const reconnect = session.reconnect();
    await Promise.resolve();
    session.reset();
    const replacement = wallet(false);
    const nextConnect = deferred<void>();
    replacement.connect.mockReturnValue(nextConnect.promise);
    session.updateWallet(replacement);
    const next = session.connect();
    pending.resolve();
    await reconnect;
    expect(source.connect).not.toHaveBeenCalled();
    nextConnect.resolve();
    await next;
    expect(replacement.connect).toHaveBeenCalledTimes(1);
  });

  it("clears an unmounted provider's deadline and never remembers its late connection", async () => {
    const { session, resetAdapter } = setup();
    const source = wallet(false);
    const pending = deferred<void>();
    source.connect.mockReturnValue(pending.promise);
    session.updateWallet(source);
    const connecting = session.connect();
    await Promise.resolve();
    session.dispose();
    pending.resolve();
    await connecting;
    await vi.advanceTimersByTimeAsync(45_000);
    expect(resetAdapter).not.toHaveBeenCalled();
    expect(localStorage.getItem(CONNECTED_KEY)).toBeNull();
  });

  it("keeps note refresh alive without consumers and deduplicates it across consumers", async () => {
    const { session, balances } = setup();
    const source = wallet();
    const notes = deferred<Awaited<ReturnType<NonNullable<MidenSessionWallet["requestConsumableNotes"]>>>>();
    source.requestConsumableNotes.mockReturnValue(notes.promise);
    session.updateWallet(source);
    await balances.requestMiden(ACCOUNT_A, "miden-testnet");
    const unsubscribe = session.subscribe(vi.fn());
    const refresh = session.refresh();
    unsubscribe();
    expect(session.refresh()).toBe(refresh);
    await vi.advanceTimersByTimeAsync(0);
    expect(source.requestConsumableNotes).toHaveBeenCalledTimes(1);
    notes.resolve([]);
    await refresh;
    expect(session.getSnapshot()).toMatchObject({ noteSyncStatus: "No consumable notes", consumableNoteCount: 0 });
  });

  it.each(["success", "failure"])("discards an old account's pending note %s", async outcome => {
    const { session, balances } = setup();
    const source = wallet();
    const notes = deferred<Awaited<ReturnType<NonNullable<MidenSessionWallet["requestConsumableNotes"]>>>>();
    source.requestConsumableNotes.mockReturnValue(notes.promise);
    session.updateWallet(source);
    await balances.requestMiden(ACCOUNT_A, "miden-testnet");
    const refresh = session.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(source.requestConsumableNotes).toHaveBeenCalledTimes(1);
    source.adapter.address = ACCOUNT_B;
    session.updateWallet({ ...source, address: ACCOUNT_B });
    expect(session.getSnapshot()).toMatchObject({ consumableNoteCount: null, noteSyncStatus: "Refresh to sync" });
    if (outcome === "success") notes.resolve([]);
    else notes.reject(new Error("Old account denied notes"));
    await refresh;
    expect(session.getSnapshot()).toMatchObject({ address: ACCOUNT_B, consumableNoteCount: null, noteSyncStatus: "Refresh to sync", error: "" });
  });

  it("blocks captured send and transaction actions immediately when the adapter account changes", async () => {
    const { session } = setup();
    const source = wallet();
    session.updateWallet(source);
    const { requestTransaction, requestSend } = session.getSnapshot();
    const transaction = {} as Parameters<NonNullable<typeof requestTransaction>>[0];
    const send = {} as Parameters<NonNullable<typeof requestSend>>[0];
    await requestTransaction!(transaction);
    await requestSend!(send);
    source.adapter.address = ACCOUNT_B; // Before React publishes the next adapter snapshot.
    expect(() => requestTransaction!(transaction)).toThrow("wallet changed");
    expect(() => requestSend!(send)).toThrow("wallet changed");
    source.adapter.address = ACCOUNT_A;
    session.reset();
    expect(() => requestTransaction!(transaction)).toThrow("wallet changed");
    expect(source.requestTransaction).toHaveBeenCalledTimes(1);
    expect(source.requestSend).toHaveBeenCalledTimes(1);
  });

  it("rejects wrong-network capabilities and isolates remembered network sessions", () => {
    localStorage.setItem(CONNECTED_KEY, "1");
    const { session } = setup("mainnet");
    const source = wallet(false);
    session.updateWallet(source);
    expect(source.connect).not.toHaveBeenCalled();
    session.updateWallet(wallet());
    expect(session.getSnapshot()).toMatchObject({ error: expect.stringContaining("Switch Bread to mainnet"), requestTransaction: undefined, requestSend: undefined });
    session.reset();
    expect(localStorage.getItem(CONNECTED_KEY)).toBe("1");
  });

  it("invalidates signing and private balances as soon as disconnect starts", async () => {
    const { session, balances } = setup();
    const source = wallet();
    source.requestAssets.mockResolvedValue([{ faucetId: MIDEN_ETH.faucetId, amount: "42" }]);
    session.updateWallet(source);
    expect(Object.keys(await balances.requestMiden(ACCOUNT_A, "miden-testnet"))).not.toHaveLength(0);
    const requestTransaction = session.getSnapshot().requestTransaction!;
    const pending = deferred<void>();
    source.disconnect.mockReturnValue(pending.promise);
    const disconnect = session.disconnect();
    session.updateWallet({ ...source }); // SDK can render the old account during disconnect.
    expect(session.getSnapshot().connected).toBe(false);
    expect(session.getSnapshot().requestTransaction).toBeUndefined();
    expect(() => requestTransaction({} as Parameters<typeof requestTransaction>[0])).toThrow("wallet changed");
    await expect(balances.requestMiden(ACCOUNT_A, "miden-testnet")).rejects.toThrow("Connect your Miden wallet");
    pending.resolve();
    await disconnect;
    expect(localStorage.getItem(CONNECTED_KEY)).toBeNull();
  });
});
