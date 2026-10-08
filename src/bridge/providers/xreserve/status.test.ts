import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeXreserveDeposit } from "./status";
import { checkArcDelivery } from "./delivery";
import type { BridgeActivity } from "../../core/models";
import { CCTP } from "./cctp-config";

vi.mock("./delivery", () => ({ checkArcDelivery: vi.fn() }));
const intent = {
  amount: "1000000", recipient: "0x4e6fb40fd2f6a55140df2c42dfb5b7",
  faucet: "0x4cbdcaffe75f0a317482224dae6436",
  sender: "0x898362f24c366fdf7bb164c40a9127cc9f5119b6", nonce: `0x${"ab".repeat(32)}`,
};
const activity: BridgeActivity = {
  id: "deposit", provider: "xreserve", routeId: "xreserve-usdc-to-miden", mode: "receive",
  amount: "1", asset: "USDC", receivedAmount: "1", status: "source_finality",
  sourceTxHash: `0x${"a".repeat(64)}`, destination: intent.recipient, evmAddress: intent.sender, updatedAt: 0,
};
const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(Response.json({ status: "attested", intent }));
  vi.mocked(checkArcDelivery).mockResolvedValue({ noteId: `0x${"c".repeat(64)}` });
});
afterEach(() => vi.unstubAllGlobals());

describe("USDCx delivery tracking", () => {
  it("tracks a forwarded deposit using the original sender and Arc handler without replacing the source hash", async () => {
    const arcTxHash = `0x${"d".repeat(64)}`;
    fetchMock.mockResolvedValue(Response.json({ status: "attested", arcTxHash,
      source: { amount: intent.amount, recipient: intent.recipient, sender: intent.sender },
      intent: { ...intent, sender: CCTP.handler },
    }));
    vi.mocked(checkArcDelivery).mockResolvedValue({ noteId: `0x${"c".repeat(64)}`, block: 42 });
    const result = await observeXreserveDeposit({ ...activity, routeId: "xreserve-base-usdc-to-miden" });
    expect(result.patch).toMatchObject({ status: "complete", xreserveArcTxHash: arcTxHash });
    expect(result.patch.sourceTxHash).toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toContain(`/api/xreserve/status?network=base-sepolia&hash=${activity.sourceTxHash}`);
  });
  it("keeps Circle attestation pending until the exact Miden note is included", async () => {
    expect((await observeXreserveDeposit(activity)).patch).toMatchObject({ status: "message_observed", xreserveStatus: "attested" });
    fetchMock.mockResolvedValue(Response.json({ status: "attested", intent }));
    vi.mocked(checkArcDelivery).mockResolvedValue({ noteId: `0x${"c".repeat(64)}`, block: 42 });
    expect((await observeXreserveDeposit(activity)).patch).toMatchObject({ status: "complete", xreserveStatus: "delivered", xreserveMidenBlock: 42, destinationTxAt: expect.any(Number) });
  });
  it.each([
    { amount: "2000000" }, { recipient: "0x5024c9a49c795e4154919db81f9176" },
    { sender: `0x${"1".repeat(40)}` }, { faucet: "0x179f749ee2329e317d96fe3ed5aaf9" }, { nonce: "bad" },
  ])("refuses an attestation with mismatched fields %j", async (patch) => {
    fetchMock.mockResolvedValue(Response.json({ status: "attested", intent: { ...intent, ...patch } }));
    await expect(observeXreserveDeposit(activity)).rejects.toThrow(/does not match/);
    expect(checkArcDelivery).not.toHaveBeenCalled();
  });
  it("preserves attestation on Circle and Miden outages without marking a failure", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ status: "confirmed", warning: "Circle unavailable" }));
    const current = { ...activity, status: "message_observed" as const, xreserveStatus: "attested" as const };
    expect((await observeXreserveDeposit(current)).patch).toMatchObject({ status: "message_observed", xreserveStatus: "attested" });
    vi.mocked(checkArcDelivery).mockRejectedValue(new Error("Miden offline"));
    expect(await observeXreserveDeposit(current)).toMatchObject({ patch: { status: "message_observed" }, warning: expect.stringMatching(/retry/) });
  });
  it("only marks failed when Arc reports a revert, and does not poll terminal transfers", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "reverted" }));
    expect((await observeXreserveDeposit(activity)).patch).toMatchObject({ status: "failed", xreserveStatus: "reverted" });
    fetchMock.mockClear();
    expect(await observeXreserveDeposit({ ...activity, status: "complete" })).toEqual({ patch: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("ignores a result returned after navigation cancelled the poll", async () => {
    const controller = new AbortController();
    vi.mocked(checkArcDelivery).mockImplementation(async () => {
      controller.abort();
      return { noteId: `0x${"c".repeat(64)}`, block: 42 };
    });
    expect(await observeXreserveDeposit(activity, controller.signal)).toEqual({ patch: {} });
  });
});
