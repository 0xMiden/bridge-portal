import { afterEach, describe, expect, it, vi } from "vitest";
import type { BridgeActivity } from "../../core/models";
import { observeXreserveWithdrawal } from "./withdrawal-status";

const { readStatus } = vi.hoisted(() => ({ readStatus: vi.fn() }));
vi.mock("@miden-sdk/miden-sdk", () => ({
  Endpoint: class {},
  NoteId: { fromHex: () => ({ free() {} }) },
  RpcClient: class { getNetworkNoteStatus = readStatus; free() {} },
}));
afterEach(() => vi.resetAllMocks());
const activity: BridgeActivity = {
  id: "burn", routeId: "xreserve-usdc-to-arc", provider: "xreserve", mode: "send",
  status: "source_finality", amount: "2", asset: "USDCx", updatedAt: 1,
  xreserveNoteId: `0x${"ab".repeat(32)}`, xreserveBurnStatus: "pending",
};

describe("withdrawal tracking", () => {
  it("tracks consumption without declaring that Circle paid the recipient", async () => {
    readStatus.mockResolvedValue({ status: "NullifierCommitted", free() {} });
    const observation = await observeXreserveWithdrawal(activity);
    expect(observation.patch).toMatchObject({ status: "message_observed", xreserveBurnStatus: "confirmed" });
    expect(observation.patch.destinationTxHash).toBeUndefined();
    expect(observation.warning).toContain("payout has not been verified");
  });
  it("does not regress a consuming burn when the RPC returns an older pending observation", async () => {
    readStatus.mockResolvedValue({ status: "Pending", free() {} });
    expect((await observeXreserveWithdrawal({ ...activity, xreserveBurnStatus: "consuming" })).patch.xreserveBurnStatus).toBe("consuming");
  });
  it("retains the note and reports a discarded burn for support", async () => {
    readStatus.mockResolvedValue({ status: "Discarded", lastError: "Minimum burn rejected", free() {} });
    const observation = await observeXreserveWithdrawal(activity);
    expect(observation.patch).toEqual({ status: "failed", xreserveBurnStatus: "discarded" });
    expect(observation.warning).toBe("Minimum burn rejected");
  });
});
