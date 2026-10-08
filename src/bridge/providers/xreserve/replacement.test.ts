import { afterEach, expect, it, vi } from "vitest";
import { observeXreserveDeposit } from "./status";
import type { BridgeActivity } from "../../core/models";
import { CCTP } from "./cctp-config";
import { ARC } from "./config";

const original = `0x${"11".repeat(32)}`;
const replacement = `0x${"22".repeat(32)}`;
const sender = `0x${"33".repeat(20)}`;
const recipient = "0x4e6fb40fd2f6a55140df2c42dfb5b7";
const transaction = { hash: original, from: sender, nonce: 7, to: ARC.xReserve, input: "0x1234", value: "0" };
const activity: BridgeActivity = {
  id: "replacement", provider: "xreserve", routeId: "xreserve-usdc-to-miden", mode: "receive",
  amount: "1", asset: "USDC", status: "source_finality", xreserveStatus: "submitted",
  sourceTxHash: original, evmAddress: sender, destination: recipient, updatedAt: 1,
};
vi.mock("./delivery", () => ({ checkArcDelivery: async () => ({ noteId: `0x${"aa".repeat(32)}`, block: 42 }) }));
afterEach(() => vi.unstubAllGlobals());

it.each([
  ["repriced", "arc-testnet"], ["cancelled", "arc-testnet"], ["replaced", "arc-testnet"],
  ["repriced", "base-sepolia"], ["cancelled", "base-sepolia"],
])("resolves a %s transaction on %s after reloading saved pending metadata", async (kind, network) => {
  const candidate = { ...transaction, hash: replacement, nonce: "0x7", value: "0x0",
    to: kind === "cancelled" ? sender : ARC.xReserve,
    input: kind === "cancelled" ? "0x" : kind === "replaced" ? "0xabcd" : transaction.input };
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    requests.push(url);
    if (url.includes("/status?")) {
      if (url.includes(replacement)) return Response.json({ status: "attested",
        ...(network === "base-sepolia" ? { source: { amount: "1000000", recipient, sender } } : {}), intent: {
        amount: "1000000", recipient, faucet: ARC.faucetId, sender: network === "base-sepolia" ? CCTP.handler : sender, nonce: `0x${"ab".repeat(32)}`,
      } });
      return Response.json({ status: "submitted" });
    }
    expect(url).toBe(`/api/evm/${network}/rpc`);
    const { method, params, id } = JSON.parse(String(init?.body));
    let result: unknown;
    if (method === "eth_getTransactionByHash") result = null; // Dropped original, including after reload.
    else if (method === "eth_blockNumber") result = "0x400";
    else if (method === "eth_getTransactionCount") result = BigInt(params[1]) >= 500n ? "0x8" : "0x7";
    else if (method === "eth_getBlockByNumber") {
      expect(params).toEqual(["0x1f4", true]);
      result = { timestamp: "0x64", transactions: [
        { ...candidate, from: `0x${"44".repeat(20)}` }, // Same nonce, unrelated sender.
        candidate,
      ] };
    } else throw new Error(`Unexpected RPC ${method}`);
    return Response.json({ jsonrpc: "2.0", id, result });
  }));
  const restored = JSON.parse(JSON.stringify({ ...activity, routeId: network === "base-sepolia" ? "xreserve-base-usdc-to-miden" : activity.routeId, sourceTransaction: transaction }));
  const result = await observeXreserveDeposit(restored);
  expect(result.patch).toMatchObject({ sourceTxHash: replacement, sourceOriginalTxHash: original,
    status: kind === "repriced" ? "complete" : "failed",
    xreserveStatus: kind === "repriced" ? "delivered" : kind });
  if (kind !== "repriced") expect(requests.filter((url) => url.includes(replacement))).toEqual([]);
});

it.each(["pending", "rpc outage"])("keeps a %s deposit active and saves its nonce for a later reload", async (scenario) => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/status?")) return Response.json({ status: "submitted" });
    const { method, id } = JSON.parse(String(init?.body));
    if (method === "eth_getTransactionByHash") return Response.json({ jsonrpc: "2.0", id,
      result: { ...transaction, nonce: "0x7", value: "0x0", blockNumber: null } });
    if (scenario === "rpc outage") throw new Error("offline");
    if (method === "eth_blockNumber") return Response.json({ jsonrpc: "2.0", id, result: "0x400" });
    if (method === "eth_getTransactionCount") return Response.json({ jsonrpc: "2.0", id, result: "0x7" });
    throw new Error(`Unexpected RPC ${method}`);
  }));
  const result = await observeXreserveDeposit(activity);
  expect(result.patch).toMatchObject({ sourceTransaction: transaction, status: "source_finality", xreserveStatus: "submitted" });
  expect(result.patch.sourceTxHash).toBeUndefined();
  if (scenario === "rpc outage") expect(result.warning).toContain("retry");
});
