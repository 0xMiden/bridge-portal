import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult } from "viem";
import { arcConfig, xReserveAbi } from "../../bridge/providers/xreserve/config";
import { arcRecipient } from "../../bridge/providers/xreserve/deposit-terms";
import type { ProviderFlows } from "../../bridge/core/provider";
import type { QuoteRequest, QuoteResult } from "../../bridge/core/quote";
import { findBridgeRoute } from "../../bridge/core/routes";
import { bridgeProviders } from "../../bridge/providers/registry";
import { ProviderOptions } from "../components/ProviderOptions";
import { availableProviderQuotes, providerQuoteRequests, transferQuoteOptions } from "./provider-quotes";

const input: QuoteRequest = {
  route: findBridgeRoute("mainnet:xreserve:ethereum:receive")!,
  amount: "100",
  evmAddress: "0x1111111111111111111111111111111111111111",
  midenAccount: "mm1aqu8zjdwvcgkeug5a67kpwmnsyv2qgp7",
};
let client: QueryClient;
const cleanups: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  // Match browser Request resolution for same-origin RPC URLs in Node.
  vi.stubGlobal("Request", class extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  });
});
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Provider I/O is stubbed; request binding, cancellation, the query cache, and UI are real.
function adapter(provider: keyof typeof bridgeProviders, quote: ProviderFlows["receive"]["quote"]) {
  const flow = { quote, submit: vi.fn(), monitor: { canPoll: () => false, observe: vi.fn() } };
  return vi.spyOn(bridgeProviders[provider], "load").mockResolvedValue({ flows: { receive: flow, send: flow } });
}

function payout(received: string): QuoteResult {
  return { kind: "epoch", received, validity: { kind: "time", expiresAt: Date.now() + 60_000 } };
}

function observe(request = input, frozen = false) {
  let requests = providerQuoteRequests(request);
  const observers = requests.map(candidate => new QueryObserver(client, transferQuoteOptions(candidate, frozen)));
  observers.forEach(observer => cleanups.push(observer.subscribe(() => {})));
  return {
    observers,
    offers: () => availableProviderQuotes(requests, observers.map(observer => observer.getCurrentResult())),
    change(next: QuoteRequest, frozen = false) {
      requests = providerQuoteRequests(next);
      observers.forEach((observer, index) => observer.setOptions(transferQuoteOptions(requests[index], frozen)));
    },
    refetch: () => Promise.all(observers.map(observer => observer.refetch())),
  };
}

function render(offers: ReturnType<typeof availableProviderQuotes>, ready = true, loading = false, route = input.route) {
  return renderToStaticMarkup(<ProviderOptions route={route} offers={offers} ready={ready} loading={loading}
    onRetry={() => {}} onSelect={() => {}} />);
}

it("starts with one provider and waits for valid terms and both wallet addresses", async () => {
  const circle = adapter("xreserve", vi.fn(async () => payout("100")));
  const epoch = adapter("epoch", vi.fn(async () => payout("99")));
  const state = observe({ ...input, amount: "" });
  for (const invalid of [
    { amount: "" }, { amount: "0" }, { amount: "0.0000001" },
    { midenAccount: "" }, { evmAddress: "" },
  ]) {
    state.change({ ...input, ...invalid });
    await vi.advanceTimersByTimeAsync(500);
    expect(state.offers()).toEqual([]);
  }
  expect(circle).not.toHaveBeenCalled();
  expect(epoch).not.toHaveBeenCalled();
  const initial = render(state.offers(), false);
  expect(initial).toContain("Circle");
  expect(initial).not.toContain("Epoch");
  expect(initial).not.toContain("You receive");
  expect(initial).not.toContain('type="radio"');
});

it("queries every compatible provider independently and only offers successful payouts", async () => {
  const slowCircle = Promise.withResolvers<QuoteResult | null>();
  const circleQuote = vi.fn<ProviderFlows["receive"]["quote"]>().mockReturnValueOnce(slowCircle.promise);
  adapter("xreserve", circleQuote);
  const epochQuote = vi.fn(async () => payout("99.123456"));
  adapter("epoch", epochQuote);
  const unrelated = adapter("agglayer", vi.fn(async () => null));
  const state = observe();
  await vi.advanceTimersByTimeAsync(400);
  expect(circleQuote).toHaveBeenCalledOnce();
  expect(epochQuote).toHaveBeenCalledOnce();
  expect(unrelated).not.toHaveBeenCalled();
  expect(state.offers().map(offer => offer.route.provider)).toEqual(["epoch"]);
  const firstQuotedRoute = state.offers()[0].route;
  const single = render(state.offers());
  expect(single).not.toContain("Choose provider");
  expect(single).toMatch(/class="selected-provider[^"]*">Epoch<\/strong>/);
  expect(single).not.toContain("<details");
  expect(single).toContain("99.123456");
  expect(single).not.toContain('aria-label="Circle"');

  slowCircle.reject(new Error("Provider unavailable"));
  await vi.advanceTimersByTimeAsync(1);
  expect(state.offers()).toHaveLength(1);
  circleQuote.mockResolvedValue(payout("100"));
  const retry = state.refetch();
  await vi.advanceTimersByTimeAsync(400);
  await retry;
  expect(state.offers()).toHaveLength(2);
  const both = render(state.offers(), true, false, firstQuotedRoute);
  expect(both).toMatch(/class="selected-provider[^"]*">Epoch<\/strong>/);
  expect(both).toContain('aria-label="Circle"');
  expect(both).toContain('aria-label="Epoch"');
  expect(both).not.toContain("<details");
  expect(both).toMatch(/<input(?=[^>]*aria-label="Epoch")(?=[^>]*checked="")[^>]*>/);
  expect(both).not.toContain("Quote required");
});

it("cancels obsolete requests and never reuses a payout after amount or wallet changes", async () => {
  const old = Promise.withResolvers<QuoteResult | null>();
  const circleQuote = vi.fn<ProviderFlows["receive"]["quote"]>()
    .mockReturnValueOnce(old.promise).mockResolvedValue(payout("200"));
  adapter("xreserve", circleQuote);
  adapter("epoch", vi.fn(async () => null));
  const state = observe();
  await vi.advanceTimersByTimeAsync(400);
  const obsoleteSignal = circleQuote.mock.calls[0][1];
  state.change({ ...input, amount: "200" });
  expect(obsoleteSignal.aborted).toBe(true);
  expect(state.offers()).toEqual([]);
  await vi.advanceTimersByTimeAsync(400);
  old.resolve(payout("100"));
  await vi.advanceTimersByTimeAsync(1);
  expect(state.offers().map(offer => offer.quote.received)).toEqual(["200"]);
  state.change({ ...input, amount: "200", evmAddress: "0x2222222222222222222222222222222222222222" });
  expect(state.offers()).toEqual([]);
  await vi.advanceTimersByTimeAsync(400);
  expect(state.offers()[0].quote.request.evmAddress).toBe("0x2222222222222222222222222222222222222222");
});

it("removes a formerly successful provider when its refreshed quote fails", async () => {
  const circleQuote = vi.fn<ProviderFlows["receive"]["quote"]>().mockResolvedValueOnce(payout("100"))
    .mockRejectedValue(new Error("Quote unavailable"));
  adapter("xreserve", circleQuote);
  adapter("epoch", vi.fn(async () => null));
  const state = observe();
  await vi.advanceTimersByTimeAsync(400);
  expect(state.offers()).toHaveLength(1);
  const refresh = state.refetch();
  await vi.advanceTimersByTimeAsync(400);
  await refresh;
  expect(state.offers()).toEqual([]);
  const empty = render(state.offers());
  expect(empty).toContain("No quotes available");
  expect(empty).toContain("Retry");
  expect(empty).not.toContain("Circle");
});

it("does not infer a payout for a fixed-rate provider that returns no quote", async () => {
  const noQuote = vi.fn(async () => null);
  adapter("agglayer", noQuote);
  const state = observe({ ...input, route: findBridgeRoute("agglayer-eth-to-miden")!, amount: "0.01" });
  await vi.advanceTimersByTimeAsync(400);
  expect(noQuote).toHaveBeenCalledOnce();
  expect(state.offers()).toEqual([]);
});

it.each([
  ["agglayer-eth-to-miden", "0.010000010000000000", "0.01000001", "sepolia"],
  ["agglayer-eth-to-sepolia", "0.01000001", "0.01000001", "sepolia"],
  ["mainnet:agglayer:ethereum:receive", "0.010000010000000000", "0.01000001", "ethereum"],
  ["mainnet:agglayer:ethereum:send", "0.01000001", "0.01000001", "ethereum"],
  ["mainnet:agglayer:ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7:receive", "2.000001", "2.000001", "ethereum"],
])("offers the real Agglayer adapter's payout for %s after checking the bridge", async (routeId, amount, received, network) => {
  // Exercise the production adapter, viem codec, query cache and selector together.
  await bridgeProviders.agglayer.load();
  let paused = false;
  const rpc = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ method: "eth_call", params: [{
      data: "0x15064c96", // isEmergencyState()
      to: network === "ethereum" ? "0x2a3dd3eb832af982ec71669e178424b10dca2ede" : "0x528e26b25a34a4a5d0dbda1d57d318153d2ed582",
    }, "latest"] });
    return Response.json({ jsonrpc: "2.0", id: body.id, result: `0x${(paused ? "1" : "0").padStart(64, "0")}` });
  });
  vi.stubGlobal("fetch", rpc);
  const route = findBridgeRoute(routeId)!;
  const state = observe({ ...input, route, amount });
  await vi.advanceTimersByTimeAsync(450);
  await vi.waitFor(() => {
    const result = state.observers[0].getCurrentResult();
    expect(result.status, String(result.error)).toBe("success");
  });
  expect(state.offers().map(offer => offer.quote.received)).toEqual([received]);
  expect(rpc).toHaveBeenCalledOnce();
  expect(rpc.mock.calls[0][0]).toBe(`/api/evm/${network}/rpc`);
  expect(render(state.offers(), true, false, route)).toContain("Agglayer");

  paused = true;
  const pausedRefresh = state.refetch();
  await vi.advanceTimersByTimeAsync(450);
  await pausedRefresh;
  expect(state.offers()).toEqual([]);

  rpc.mockRejectedValue(new Error("RPC unavailable"));
  const failedRefresh = state.refetch();
  await vi.advanceTimersByTimeAsync(450);
  await failedRefresh;
  expect(state.offers()).toEqual([]);
});

it.each(["xreserve-usdc-to-miden", "mainnet:xreserve:arc:receive"])(
  "offers direct Arc deposits only after verifying the deployed token mapping: %s", async routeId => {
    await bridgeProviders.xreserve.load();
    const route = findBridgeRoute(routeId)!;
    const arc = arcConfig(route.recovery);
    let registered = true;
    let token = arcRecipient(arc.faucetId);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(`/api/evm/${arc.network}/rpc`);
      const body = JSON.parse(String(init.body));
      expect(body.params[0].to.toLowerCase()).toBe(arc.xReserve.toLowerCase());
      const { functionName } = decodeFunctionData({ abi: xReserveAbi, data: body.params[0].data });
      if (functionName !== "isRemoteDomainRegistered" && functionName !== "getRemoteToken") throw new Error("Unexpected contract read");
      return Response.json({ jsonrpc: "2.0", id: body.id, result: encodeFunctionResult({
        abi: xReserveAbi, functionName, result: functionName === "isRemoteDomainRegistered" ? registered : token,
      }) });
    }));
    const state = observe({ ...input, route, amount: "1.000001" });
    await vi.advanceTimersByTimeAsync(450);
    await vi.waitFor(() => expect(state.offers().map(offer => offer.quote.received)).toEqual(["1.000001"]));
    for (const failure of ["unregistered", "wrong token"]) {
      registered = failure !== "unregistered";
      if (registered) token = `0x${"00".repeat(32)}`;
      const refresh = state.refetch();
      await vi.advanceTimersByTimeAsync(450);
      await refresh;
      expect(state.offers()).toEqual([]);
    }
  },
);

it("hides expired and zero-output quotes and freezes all requests during review", async () => {
  const circleQuote = vi.fn(async () => payout("100"));
  adapter("xreserve", circleQuote);
  adapter("epoch", vi.fn(async () => payout("0")));
  const state = observe(input, true);
  await vi.advanceTimersByTimeAsync(500);
  expect(circleQuote).not.toHaveBeenCalled();
  state.change(input);
  await vi.advanceTimersByTimeAsync(400);
  expect(state.offers().map(offer => offer.route.provider)).toEqual(["xreserve"]);
  state.change(input, true);
  await vi.advanceTimersByTimeAsync(60_001);
  expect(circleQuote).toHaveBeenCalledOnce();
  expect(state.offers()).toEqual([]);
});
