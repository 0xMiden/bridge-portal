import { currentBridgeConfig } from "../../../../config/bridge-config";
import { afterEach, expect, test, vi } from "vitest";
import { POST } from "./route";
import { observeActivity } from "../../../../bridge/tracking";
import { applyActivityPatch } from "../../../../bridge/activity";
import type { Activity } from "../../../../bridge/core/models";
import { bridgeRoutes } from "../../../../bridge/core/routes";

afterEach(() => vi.unstubAllGlobals());

test("queries deposits by their EVM bridge destination and rejects the account alias", async () => {
  const address = "0x00000000387149ae66116cf114eebd60bb738100";
  const deposit = { tx_hash: "0xsource", deposit_cnt: 42 };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ deposits: [deposit] }));
  vi.stubGlobal("fetch", fetcher);

  const response = await POST(new Request(`https://bridge.test/api/agglayer/deposits?destinationAddress=${address}`, { method: "POST", body: JSON.stringify({ recovery: currentBridgeConfig("testnet") }) }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ destinationAddress: address, deposits: [deposit] });
  expect(fetcher.mock.calls[0]?.[0]).toContain(`/bridges/${address}`);

  fetcher.mockClear();
  const invalid = await POST(new Request("https://bridge.test/api/agglayer/deposits?midenAccountId=0x387149ae66116cf114eebd60bb7381", {
    method: "POST", body: JSON.stringify({ recovery: currentBridgeConfig("testnet") }),
  }));
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({ error: "destinationAddress must be a 20-byte hex address." });
  expect(fetcher).not.toHaveBeenCalled();
});

test.each([
  { newerDeposits: 1, indexed: true },
  { newerDeposits: 101, indexed: true },
  { newerDeposits: 1, indexed: false },
])("tracks the exact receive with $newerDeposits newer deposits (indexed: $indexed)", async ({ newerDeposits, indexed }) => {
  const sourceTxHash = `0x${"ab".repeat(32)}`;
  const claimTxHash = `0x${"cd".repeat(32)}`;
  const address = "0x00000000387149ae66116cf114eebd60bb738100";
  const route = bridgeRoutes.find((route) =>
    route.provider === "agglayer" && route.mode === "receive" && route.source.network === "ethereum",
  )!;
  const activity: Activity = {
    id: "older-deposit", provider: "agglayer", mode: "receive", environment: "mainnet",
    routeSnapshot: route, sourceTxHash, bridgeDestinationAddress: address,
    amount: "0.0001", asset: "ETH", status: "message_observed",
    updatedAt: 1, summary: "", eta: "Waiting", txHash: sourceTxHash,
  };
  const deposits = Array.from({ length: newerDeposits }, (_, index) => ({
    tx_hash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
    deposit_cnt: index + 43, ready_for_claim: true, claim_tx_hash: `0x${"ef".repeat(32)}`,
  }));
  if (indexed) deposits.push({
    tx_hash: `0x${"AB".repeat(32)}`, deposit_cnt: 42,
    ready_for_claim: true, claim_tx_hash: claimTxHash,
  });
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), "https://bridge.test");
    if (url.origin === "https://bridge.test" && url.pathname === "/api/agglayer/deposits")
      return POST(new Request(url, init));
    if (url.origin === "https://bridge.test" && url.pathname === "/api/evm/ethereum/transaction")
      return Response.json({ hash: sourceTxHash, status: "confirmed", success: true });
    if (url.origin === "https://bridge-cedar-miden.eu-north-3.gateway.fm" &&
        url.pathname === `/api/bridges/${address}`) {
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      return Response.json({ deposits: deposits.slice(offset, offset + limit), total_cnt: String(deposits.length) });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  const observation = await observeActivity(activity, new AbortController().signal);
  const next = applyActivityPatch(activity, observation!.patch);
  expect(observation?.warning).toBeUndefined();
  expect(next.status).toBe(indexed ? "complete" : "message_observed");
  expect(next.midenTxId).toBe(indexed ? claimTxHash : undefined);
  expect(next.depositCount).toBe(indexed ? "42" : undefined);
});
