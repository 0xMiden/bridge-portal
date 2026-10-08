import { QueryClient, QueryObserver, focusManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BalanceStore } from "./balance-store";
import { ARC_USDC, MIDEN_ETH, MIDEN_USDC, SEPOLIA_ETH, SEPOLIA_USDC } from "./core/assets";
import { midenBalanceKey } from "./miden-balances";

vi.mock("../wallets/testing/env", () => ({ isE2E: () => true, e2eNetwork: () => "mock" }));

const account = "0xabcd";
const network = "miden-testnet";
const holdings = [{ faucetId: MIDEN_ETH.faucetId, amount: "150000000" }];
let client: QueryClient;
let store: BalanceStore;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.mount();
  store = new BalanceStore(client);
});

afterEach(() => {
  client.unmount();
  client.clear();
  focusManager.setFocused(undefined);
  vi.unstubAllGlobals();
});

describe("private balance sessions", () => {
  it("shares one opted-in request across consumers and keeps its result after unmount", async () => {
    const pending = Promise.withResolvers<typeof holdings>();
    const requestAssets = vi.fn(() => pending.promise);
    store.setMidenSession({ account, network, requestAssets });
    const observer = new QueryObserver(client, store.midenQuery(account, network));
    const unsubscribe = observer.subscribe(() => {});
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(requestAssets).not.toHaveBeenCalled();

    const first = store.requestMiden(account, network);
    const second = store.requestMiden(account.toUpperCase(), network, true);
    await vi.waitFor(() => expect(requestAssets).toHaveBeenCalledOnce());
    unsubscribe();
    pending.resolve(holdings);
    await Promise.all([first, second]);

    const remounted = new QueryObserver(client, store.midenQuery(account, network));
    const stop = remounted.subscribe(() => {});
    expect(remounted.getCurrentResult().data?.[midenBalanceKey(account, MIDEN_ETH)]).toMatchObject({
      balance: "1.5", amountRaw: 150000000n, decimals: 8,
    });
    expect(remounted.getCurrentResult().data?.[midenBalanceKey(account, MIDEN_USDC)]?.balance).toBe("0");
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await client.invalidateQueries();
    await client.refetchQueries();
    expect(requestAssets).toHaveBeenCalledOnce();
    stop();
  });

  it("only reopens the permission request on explicit refresh and deduplicates refreshes", async () => {
    const requestAssets = vi.fn(async () => holdings);
    store.setMidenSession({ account, network, requestAssets });
    await store.requestMiden(account, network);
    await store.requestMiden(account, network);
    expect(requestAssets).toHaveBeenCalledOnce();

    const pending = Promise.withResolvers<typeof holdings>();
    requestAssets.mockImplementation(() => pending.promise);
    const first = store.requestMiden(account, network, true);
    const second = store.requestMiden(account, network, true);
    await vi.waitFor(() => expect(requestAssets).toHaveBeenCalledTimes(2));
    pending.resolve([{ faucetId: MIDEN_ETH.faucetId, amount: "250000000" }]);
    await Promise.all([first, second]);
    expect(client.getQueryData(store.midenQuery(account, network).queryKey)?.[midenBalanceKey(account, MIDEN_ETH)]?.balance).toBe("2.5");
  });

  it("lets a denied read retry explicitly without retrying the permission prompt automatically", async () => {
    const requestAssets = vi.fn().mockRejectedValueOnce(new Error("User denied access")).mockResolvedValue(holdings);
    store.setMidenSession({ account, network, requestAssets });
    const observer = new QueryObserver(client, store.midenQuery(account, network));
    const stop = observer.subscribe(() => {});
    await expect(store.requestMiden(account, network)).rejects.toThrow("User denied access");
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(requestAssets).toHaveBeenCalledOnce();
    await store.requestMiden(account, network);
    expect(observer.getCurrentResult().data?.[midenBalanceKey(account, MIDEN_ETH)]?.balance).toBe("1.5");
    stop();
  });

  it.each(["disconnect", "switch accounts"])("clears private data and discards a pending refresh when wallets %s", async (change) => {
    const requestAssets = vi.fn(async () => holdings);
    store.setMidenSession({ account, network, requestAssets });
    const observer = new QueryObserver(client, store.midenQuery(account, network));
    const stop = observer.subscribe(() => {});
    await store.requestMiden(account, network);
    const pending = Promise.withResolvers<typeof holdings>();
    requestAssets.mockImplementation(() => pending.promise);
    const completion = store.requestMiden(account, network, true).catch(() => undefined);
    await vi.waitFor(() => expect(requestAssets).toHaveBeenCalledTimes(2));

    const anotherWallet = vi.fn(async () => [{ faucetId: MIDEN_ETH.faucetId, amount: "300000000" }]);
    store.setMidenSession(change === "disconnect" ? null : { account: "0xdef0", network, requestAssets: anotherWallet });
    expect(observer.getCurrentResult().data).toBeUndefined();
    pending.resolve(holdings);
    await completion;
    expect(client.getQueryData(store.midenQuery(account, network).queryKey)).toBeUndefined();
    expect(anotherWallet).not.toHaveBeenCalled();
    await expect(store.requestMiden(account, network)).rejects.toThrow("Connect your Miden wallet");

    store.setMidenSession({ account, network, requestAssets: anotherWallet });
    expect(client.getQueryData(store.midenQuery(account, network).queryKey)).toBeUndefined();
    await store.requestMiden(account, network);
    expect(anotherWallet).toHaveBeenCalledOnce();
    expect(client.getQueryData(store.midenQuery(account, network).queryKey)?.[midenBalanceKey(account, MIDEN_ETH)]?.balance).toBe("3");
    expect(observer.getCurrentResult().data?.[midenBalanceKey(account, MIDEN_ETH)]?.balance).toBe("3");
    stop();
  });
});

describe("public token balances", () => {
  const evmAccount = "0x1111111111111111111111111111111111111111";

  it("shares reads for a token, isolates native ETH and other accounts, and invalidates the minted token", async () => {
    const request = vi.fn(async (url: string) => Response.json(url.includes("token=")
      ? { balanceRaw: "2500000000000000000" }
      : { balanceRaw: "750000000000000000" }));
    vi.stubGlobal("fetch", request);
    const usdc = store.evmQuery(evmAccount, SEPOLIA_USDC);
    const eth = store.evmQuery(evmAccount, SEPOLIA_ETH);
    const results = await Promise.all([client.fetchQuery(usdc), client.fetchQuery(usdc), client.fetchQuery(eth)]);
    expect(results.map((result) => result.balance)).toEqual(["2.5", "2.5", "0.75"]);
    expect(request).toHaveBeenCalledTimes(2);
    const url = new URL(request.mock.calls[0][0], "http://localhost");
    expect(url.searchParams.get("token")).toBe(SEPOLIA_USDC.address);
    expect(url.searchParams.get("decimals")).toBe("18");
    expect(client.getQueryData(store.evmQuery("0x2222222222222222222222222222222222222222", SEPOLIA_USDC).queryKey)).toBeUndefined();

    await store.invalidateSepolia(evmAccount, SEPOLIA_USDC);
    request.mockResolvedValue(Response.json({ balanceRaw: "4500000000000000000" }));
    expect((await client.fetchQuery(usdc)).balance).toBe("4.5");
    expect((await client.fetchQuery(eth)).balance).toBe("0.75");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it.each([
    { status: 502, payload: { error: "RPC unavailable" } },
    { status: 200, payload: {} },
  ])("keeps an unavailable balance distinct from zero ($status)", async ({ status, payload }) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload, { status })));
    const query = store.evmQuery(evmAccount, SEPOLIA_USDC);
    await expect(client.fetchQuery(query)).rejects.toThrow();
    expect(client.getQueryData(query.queryKey)).toBeUndefined();
  });
});


it("reads Arc USDC with six decimals without reusing Sepolia's token balance", async () => {
  const request = vi.fn(async (url: string) => Response.json({ balanceRaw: url.startsWith("/api/evm/arc-testnet/") ? "1234567" : "2500000000000000000" }));
  vi.stubGlobal("fetch", request);
  const [arc, sepolia] = await Promise.all([
    client.fetchQuery(store.evmQuery(account, ARC_USDC)),
    client.fetchQuery(store.evmQuery(account, SEPOLIA_USDC)),
  ]);
  expect(arc.balance).toBe("1.234567");
  expect(sepolia.balance).toBe("2.5");
  expect(request).toHaveBeenCalledTimes(2);
});
