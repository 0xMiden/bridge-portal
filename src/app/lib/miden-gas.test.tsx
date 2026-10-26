import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { getMidenVerificationBaseFee } from "../../bridge/miden-rpc";
import { BalanceProvider } from "../../bridge/BalanceProvider";
import { defaultBridgeRoute, type BridgeRoute } from "../../bridge/core/routes";
import { currentBridgeConfig, type BridgeConfig } from "../../config/bridge-config";
import { useBridgeQuote } from "../components/bridge/use-bridge-quote";
import type { BridgeWallets } from "../components/bridge/use-bridge-wallets";
import { midenGasQuery, useMidenGasEstimate } from "./miden-gas";

vi.mock("../../bridge/miden-rpc", () => ({ getMidenVerificationBaseFee: vi.fn() }));
afterEach(() => vi.resetAllMocks());

function Fee({ recovery, enabled = true }: { recovery: BridgeConfig; enabled?: boolean }) {
  return <>{useMidenGasEstimate(recovery, enabled)}</>;
}

function RouteFee({ route }: { route: BridgeRoute }) {
  const wallets = {
    accounts: { evmAddress: "", midenAccount: "" },
    evm: { connected: false, balance: {}, token: route.destination.kind !== "miden" ? route.destination : route.source },
  } as BridgeWallets;
  return <>{useBridgeQuote(route, "2", wallets).networkFee}</>;
}

it.each(["mainnet", "testnet"] as const)("shows the Miden fee for both Epoch and Circle withdrawals on %s", async environment => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const render = (route: BridgeRoute) => renderToStaticMarkup(
    <QueryClientProvider client={client}><BalanceProvider><RouteFee route={route} /></BalanceProvider></QueryClientProvider>,
  );
  try {
    vi.mocked(getMidenVerificationBaseFee).mockResolvedValue(7);
    await client.fetchQuery(midenGasQuery(currentBridgeConfig(environment), true));
    for (const provider of ["epoch", "xreserve"] as const) {
      expect(render(defaultBridgeRoute(provider, "send", environment)!)).toBe("≈ 0.00021 USDCx");
      expect(render(defaultBridgeRoute(provider, "receive", environment)!)).not.toContain("≈ 0.00021 USDCx");
    }
  } finally { client.clear(); }
});

it("calculates USDCx from live rates, isolates networks, and hides a failed refresh", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const mainnet = currentBridgeConfig("mainnet");
  const testnet = currentBridgeConfig("testnet");
  const render = (recovery: BridgeConfig) => renderToStaticMarkup(
    <QueryClientProvider client={client}><Fee recovery={recovery} /></QueryClientProvider>,
  );
  try {
    expect(render(mainnet)).toBe("Estimating…");
    vi.mocked(getMidenVerificationBaseFee).mockResolvedValueOnce(7).mockResolvedValueOnce(20);
    await client.fetchQuery(midenGasQuery(mainnet, true));
    await client.fetchQuery(midenGasQuery(testnet, true));
    expect(render(mainnet)).toBe("≈ 0.00021 USDCx");
    expect(render(testnet)).toBe("≈ 0.0006 USDCx");

    vi.mocked(getMidenVerificationBaseFee).mockResolvedValueOnce(10);
    await client.fetchQuery({ ...midenGasQuery(mainnet, true), staleTime: 0 });
    expect(render(mainnet)).toBe("≈ 0.0003 USDCx");

    vi.mocked(getMidenVerificationBaseFee).mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(client.fetchQuery({ ...midenGasQuery(mainnet, true), staleTime: 0 })).rejects.toThrow("RPC unavailable");
    expect(render(mainnet)).toBe("Unavailable");
    expect(render(testnet)).toBe("≈ 0.0006 USDCx");

    vi.mocked(getMidenVerificationBaseFee).mockResolvedValueOnce(0);
    await client.fetchQuery({ ...midenGasQuery(mainnet, true), staleTime: 0 });
    expect(render(mainnet)).toBe("0 USDCx");
  } finally { client.clear(); }
});

it("keeps a disabled estimate hidden without reading the network", async () => {
  const client = new QueryClient();
  const recovery = currentBridgeConfig("mainnet");
  const observer = new QueryObserver(client, midenGasQuery(recovery, false));
  const unsubscribe = observer.subscribe(() => {});
  try {
    expect(renderToStaticMarkup(<QueryClientProvider client={client}><Fee recovery={recovery} enabled={false} /></QueryClientProvider>)).toBe("");
    expect(observer.getCurrentResult().fetchStatus).toBe("idle");
    expect(getMidenVerificationBaseFee).not.toHaveBeenCalled();
  } finally { unsubscribe(); client.clear(); }
});
