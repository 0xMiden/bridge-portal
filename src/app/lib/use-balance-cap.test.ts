import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { useBalanceStore, useMidenBalances } from "../../bridge/BalanceProvider";
import { BalanceStore } from "../../bridge/balance-store";
import { EPOCH_MIDEN_USDC, MIDEN_ETH } from "../../bridge/core/assets";
import { findBridgeRoute } from "../../bridge/core/routes";
import { useBalanceCap } from "./use-balance-cap";
vi.mock("../../bridge/miden-rpc", () => ({ getMidenFaucetMetadata: vi.fn(async () => null) }));

// Mock only React's observation boundary; confirmation uses the real store,
// query cache, wallet asset loader, price request, and cap evaluator.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useQueries: () => [],
  useQueryClient: vi.fn(),
}));
vi.mock("../../bridge/BalanceProvider", () => ({
  useBalanceStore: vi.fn(),
  useMidenBalances: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("requires another review when wallet sync adds a priced holding during confirmation", async () => {
  const account = "0xabcd";
  const network = "miden-testnet";
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const store = new BalanceStore(client);
  let holdings = [{ faucetId: MIDEN_ETH.faucetId, amount: "10000000" }];
  store.setMidenSession({ account, network, requestAssets: async () => holdings });
  const balances = await store.requestMiden(account, network);
  vi.mocked(useQueryClient).mockReturnValue(client);
  vi.mocked(useBalanceStore).mockReturnValue(store);
  vi.mocked(useMidenBalances).mockReturnValue({
    balances, loading: false, error: null,
    show: () => store.requestMiden(account, network),
    refresh: () => store.requestMiden(account, network, true),
  });

  const priceRequested = Promise.withResolvers<void>();
  const releasePrice = Promise.withResolvers<Response>();
  vi.stubGlobal("fetch", vi.fn(async () => {
    priceRequested.resolve();
    return releasePrice.promise;
  }));
  const route = findBridgeRoute("agglayer-eth-to-miden")!;
  const cap = useBalanceCap(route, "0.01", account);
  const verification = cap.verifyBalanceCap(route, "0.01", account).then(() => null, error => error);
  try {
    await priceRequested.promise;
    // This supported USDC faucet was zero when the price set was selected.
    // An explicit wallet sync must not let its newly received $2,000 be skipped.
    holdings = [...holdings, { faucetId: EPOCH_MIDEN_USDC.faucetId, amount: "2000000000" }];
    await store.requestMiden(account, network, true);
    releasePrice.resolve(Response.json({ symbol: "ETH", usd: 1000, usdDecimal: "1000", fetchedAt: Date.now() }));
    expect(await verification).toEqual(expect.objectContaining({ message: expect.stringMatching(/review/i) }));
  } finally {
    client.clear();
  }
});
