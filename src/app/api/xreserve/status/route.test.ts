import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { GET } from "./route";
import { getCctpStatus } from "../../../../bridge/providers/xreserve/cctp-status";
vi.mock("../../../../bridge/providers/xreserve/cctp-status", () => ({ getCctpStatus: vi.fn() }));
const mocks = vi.hoisted(() => ({ receipt: vi.fn(), block: vi.fn() }));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => ({ getTransactionReceipt: mocks.receipt, getBlock: mocks.block }),
}));
// Circle DepositIntent v1 wire fixture and matching chain event. Addresses are
// the v0.17 testnet faucet/distributor; field widths come from the protocol codec.
const recipient = "0x000000000000000000000000000000004e6fb40fd2f6a55140df2c42dfb5b700";
const faucet = "0x000000000000000000000000000000004cbdcaffe75f0a317482224dae643600";
const sender = "0x898362f24c366fdf7bb164c40a9127cc9f5119b6";
const token = "0x3600000000000000000000000000000000000000";
const payload = "0x5a2e0acd00000001" + "f4240".padStart(64, "0") + "00002717" +
  faucet.slice(2) + recipient.slice(2) + token.slice(2).padStart(64, "0") + sender.slice(2).padStart(64, "0") +
  "0".repeat(64) + "ab".repeat(32) + "00000000";
const eventAbi = parseAbi(["event DepositedToRemote(address indexed localToken, uint256 value, address indexed localDepositor, bytes32 indexed remoteRecipient, uint32 remoteDomain, bytes32 remoteToken, uint256 maxFee, bytes hookData)"]);
const log = {
  address: "0x008888878f94C0d87defdf0B07f46B93C1934442",
  topics: encodeEventTopics({ abi: eventAbi, eventName: "DepositedToRemote", args: { localToken: token, localDepositor: sender, remoteRecipient: recipient } }),
  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint32" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes" }], [1_000_000n, 10007, faucet, 0n, "0x"]),
};
const request = () => new Request(`http://localhost/api/xreserve/status?network=arc-testnet&hash=0x${"a".repeat(64)}`);
const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  mocks.receipt.mockResolvedValue({ status: "success", logs: [log] });
  mocks.block.mockResolvedValue({ timestamp: 1791456556n });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(Response.json({ attestations: [{ remoteDomain: 10007, attestation: "0x1234", payload }] }));
});
afterEach(() => vi.unstubAllGlobals());
it("anchors the Circle response to the on-chain deposit and exposes recovery details, never delivery", async () => {
  const result = await (await GET(request())).json();
  expect(result.sourceTxAt).toBe(1791456556000);
  expect(result).toMatchObject({ status: "attested", deposit: { amount: "1000000", recipient: "0x4e6fb40fd2f6a55140df2c42dfb5b7", faucet: "0x4cbdcaffe75f0a317482224dae6436", sender }, intent: { nonce: `0x${"ab".repeat(32)}` } });
});
it.each([{ logs: [] }, { logs: [{ ...log, address: sender }] }, { logs: [log, log] }])("rejects unrelated or ambiguous deposits", async ({ logs }) => {
  mocks.receipt.mockResolvedValue({ status: "success", logs });
  expect((await GET(request())).status).toBe(422);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("does not trust a mismatched Circle amount, or confuse attestation with delivery", async () => {
  fetchMock.mockResolvedValue(Response.json({ attestations: [{ remoteDomain: 10007, attestation: "0x1234", payload: payload.replace("0f4240", "1e8480") }] }));
  expect(await (await GET(request())).json()).toMatchObject({ status: "confirmed", warning: expect.any(String) });
});
it.each(["http", "network", "json"])("retains confirmation and recovery during Circle %s failures", async (failure) => {
  if (failure === "http") fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
  if (failure === "network") fetchMock.mockRejectedValue(new Error("offline"));
  if (failure === "json") fetchMock.mockResolvedValue(new Response("oops"));
  expect(await (await GET(request())).json()).toMatchObject({ status: "confirmed", deposit: { amount: "1000000" }, warning: expect.any(String) });
});
it("distinguishes a missing receipt, an RPC outage, and a reverted deposit", async () => {
  mocks.receipt.mockRejectedValueOnce(Object.assign(new Error(), { name: "TransactionReceiptNotFoundError" }));
  expect(await (await GET(request())).json()).toEqual({ status: "submitted" });
  mocks.receipt.mockRejectedValueOnce(new Error("offline"));
  expect((await GET(request())).status).toBe(502);
  mocks.receipt.mockResolvedValueOnce({ status: "reverted" });
  expect(await (await GET(request())).json()).toEqual({ status: "reverted" });
});
it("rejects malformed hashes before network access", async () => {
  expect((await GET(new Request("http://localhost/api/xreserve/status?network=arc-testnet&hash=bad"))).status).toBe(400);
  expect(mocks.receipt).not.toHaveBeenCalled();
});
it.each(["sepolia", "base-sepolia", "arbitrum-sepolia"])("tracks %s through its forwarding provider", async (network) => {
  vi.mocked(getCctpStatus).mockResolvedValue({ status: "submitted", forwarding: true });
  const hash = `0x${"a".repeat(64)}`;
  const response = await GET(new Request(`http://localhost/api/xreserve/status?network=${network}&hash=${hash}`));
  expect(await response.json()).toEqual({ status: "submitted", forwarding: true });
  expect(getCctpStatus).toHaveBeenCalledWith(network, hash);
  expect(mocks.receipt).not.toHaveBeenCalled();
});
it("rejects unknown origins without treating them as Arc", async () => {
  expect((await GET(new Request(`http://localhost/api/xreserve/status?network=mainnet&hash=0x${"a".repeat(64)}`))).status).toBe(400);
  expect(getCctpStatus).not.toHaveBeenCalled();
  expect(mocks.receipt).not.toHaveBeenCalled();
});
