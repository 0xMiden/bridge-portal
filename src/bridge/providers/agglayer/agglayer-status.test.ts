import { afterEach, describe, expect, it, vi } from "vitest";
import { findMidenToEvmDeposit } from "./agglayer-status";
import { observeActivity } from "../../tracking";
import { applyActivityPatch } from "../../activity";
import type { Activity } from "../../core/models";

afterEach(() => vi.unstubAllGlobals());

describe("withdrawal indexer routing", () => {
  it("keeps a known withdrawal pending when the indexer only returns someone else's claimed exit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ deposits: [
      { network_id: 73, dest_net: 0, deposit_cnt: 99, claim_tx_hash: `0x${"ab".repeat(32)}` },
    ] })));
    const activity: Activity = {
      id: "known-exit", provider: "agglayer", mode: "send", amount: "1", asset: "ETH",
      status: "source_finality", destination: "0x1111111111111111111111111111111111111111",
      depositCount: "42", updatedAt: 1, summary: "", eta: "Waiting", txHash: "",
    };
    const observation = await observeActivity(activity, new AbortController().signal);
    const next = applyActivityPatch(activity, observation!.patch);
    expect(next.status).toBe("source_finality");
    expect(next.depositCount).toBe("42");
    expect(next.destinationTxHash).toBeUndefined();
  });

  it("tracks Cardona network 73, excluding retired networks and other destinations", async () => {
    const exit = { network_id: 73, dest_net: 0, deposit_cnt: 3, claim_tx_hash: "0xabc" };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ deposits: [
      { ...exit, network_id: 1, deposit_cnt: 99 },
      { ...exit, network_id: 86, deposit_cnt: 100 },
      { ...exit, dest_net: 73, deposit_cnt: 101 },
      exit,
      { ...exit, deposit_cnt: 2 },
    ] })));
    expect(await findMidenToEvmDeposit("0xabc")).toEqual(exit);
    expect(await findMidenToEvmDeposit("0xabc", "2")).toEqual({ ...exit, deposit_cnt: 2 });
  });

  it("returns null when only retired rollup rows are present", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ deposits: [
      { network_id: 78, dest_net: 0, deposit_cnt: 99 },
    ] })));
    expect(await findMidenToEvmDeposit("0xabc")).toBeNull();
  });
});
