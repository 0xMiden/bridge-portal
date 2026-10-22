import { afterEach, expect, test, vi } from "vitest";
import { GET } from "./route";
import { routesForEnvironment } from "../../../../bridge/core/routes";
import { observeActivity } from "../../../../bridge/tracking";
import { loadStoredActivities, patchStoredActivity, saveActivities } from "../../../lib/bridge-persistence";
import fixture from "../../../../bridge/providers/agglayer/fixtures/synthetic-withdrawal.json";

afterEach(() => vi.unstubAllGlobals());
const route = routesForEnvironment("mainnet").find(route => route.provider === "agglayer" && route.mode === "send")!;
const request = () => new Request(`https://bridge.test/api/agglayer/withdrawal?sourceTxHash=${fixture.sourceTxHash}&deployment=${route.deploymentId}`);
const locator = () => Response.json({ data: { transaction: {
  transaction_id: fixture.sourceTxHash, account_bech: fixture.account, block_number: String(fixture.block),
} } });

test("recovers a saved withdrawal from its public header, persists exit #42 and only settles on its own claim", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  let claimed = false;
  let syncRequest: string | undefined;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), "https://bridge.test");
    if (url.pathname === "/api/agglayer/withdrawal") return GET(new Request(url));
    if (url.pathname === "/graphql") return locator();
    if (url.pathname === "/miden.node.v1.NodeService/SyncTransactions") {
      syncRequest = Buffer.from(init!.body as Uint8Array).toString("hex");
      return new Response(Buffer.from(fixture.grpcResponse, "base64"));
    }
    if (url.pathname.startsWith("/api/bridges/")) return Response.json({
      deposits: fixture.deposits.map(deposit => deposit.deposit_cnt === 42 && claimed
        ? { ...deposit, claim_tx_hash: `0x${"ef".repeat(32)}`, ready_for_claim: true } : deposit),
      total_cnt: fixture.total_cnt,
    });
    throw new Error(`Unexpected request: ${url}`);
  }));
  saveActivities([{
    id: "act-synthetic-withdrawal", provider: "agglayer", mode: "send", routeSnapshot: route,
    amount: "1", asset: "ETH", status: "complete", midenTxId: fixture.sourceTxHash,
    destination: fixture.deposits[0].dest_addr, depositCount: "41", readyForClaim: true,
    destinationTxHash: fixture.deposits[1].claim_tx_hash, claimTxHash: fixture.deposits[1].claim_tx_hash,
    sourceTxAt: 1_700_000_000_000, destinationTxAt: 1_700_000_001_000,
    updatedAt: 1_700_000_001_000, eta: "Settled on Ethereum", txHash: "", summary: "",
  }]);
  const [pending] = loadStoredActivities();
  const observation = await observeActivity(pending, new AbortController().signal);
  // Protocol request for synthetic account 0x102030405060704108090a0b0c0d0e at block 1000.
  expect(syncRequest).toBe("00000000260a0a0de803000015e803000012180a160a0909000e0d0c0b0a09081209094170605040302010");
  patchStoredActivity(pending.id, observation!.patch);
  const [repaired] = loadStoredActivities();
  expect(repaired).toMatchObject({ status: "message_observed", depositCount: "42", midenTxId: fixture.sourceTxHash });
  expect(repaired.agglayerExitHashes).toContain(fixture.deposits[0].tx_hash);
  expect(repaired.destinationTxHash).toBeUndefined();
  expect(repaired.claimTxHash).toBeUndefined();
  expect(repaired.destinationTxAt).toBeUndefined();
  expect(repaired.sourceTxAt).toBe(1_700_000_000_000);
  claimed = true;
  patchStoredActivity(repaired.id, (await observeActivity(repaired, new AbortController().signal))!.patch);
  expect(loadStoredActivities()[0]).toMatchObject({ status: "complete", depositCount: "42", destinationTxHash: `0x${"ef".repeat(32)}` });
  expect(await observeActivity(loadStoredActivities()[0], new AbortController().signal)).toBeNull();
});

test.each(["wrong transaction", "wrong account", "wrong block", "RPC error", "truncated"])("rejects recovery on %s", async failure => {
  const bytes = Buffer.from(fixture.grpcResponse, "base64");
  if (failure === "wrong transaction") bytes[bytes.indexOf(Buffer.from(fixture.sourceTxHash.slice(2), "hex"))] ^= 1;
  if (failure === "wrong account") bytes[bytes.indexOf(Buffer.from("4170605040302010", "hex"))] ^= 1;
  if (failure === "wrong block") bytes[bytes.indexOf(Buffer.from("0de8030000", "hex")) + 1] ^= 1;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => String(input).endsWith("/graphql")
    ? locator() : failure === "RPC error" ? new Response(null, { headers: { "grpc-status": "14" } })
      : new Response(failure === "truncated" ? bytes.subarray(0, bytes.length - 5) : bytes)));
  const response = await GET(request());
  if (failure === "wrong transaction") expect(await response.json()).toEqual({ exitHashes: [] });
  else expect(response.status).toBe(502);
});

test("rejects untrusted deployments and invalid transaction IDs before contacting a server", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  for (const params of ["sourceTxHash=bad", `sourceTxHash=${fixture.sourceTxHash}&deployment=https://evil.example`])
    expect((await GET(new Request(`https://bridge.test/api/agglayer/withdrawal?${params}`))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
