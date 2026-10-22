import { afterEach, describe, expect, it, vi } from "vitest";
import { findMidenToEvmDeposit } from "./agglayer-status";
import { observeActivity } from "../../tracking";
import { applyActivityPatch } from "../../activity";
import type { Activity } from "../../core/models";

afterEach(() => vi.unstubAllGlobals());

describe("withdrawal indexer routing", () => {
  it("waits for this withdrawal's exit instead of settling against an older claim to the same address", async () => {
    const oldClaim = `0x${"bb".repeat(32)}`;
    const exitHash = `0x${"cc".repeat(32)}`;
    const destination = `0x${"aa".repeat(20)}`;
    const activity = {
      id: "new-withdrawal", provider: "agglayer", mode: "send", amount: "1", asset: "ETH",
      status: "source_finality", destination,
      midenTxId: `0x${"11".repeat(32)}`,
      agglayerExitHashes: [exitHash], updatedAt: 1, summary: "", eta: "Waiting", txHash: "",
    } satisfies Activity & { agglayerExitHashes: string[] };
    const oldExit = {
      network_id: 73, dest_net: 0, dest_addr: destination, deposit_cnt: 1,
      tx_hash: `0x${"ab".repeat(32)}`, claim_tx_hash: oldClaim,
    };
    const fetcher = vi.fn().mockResolvedValue(Response.json({ deposits: [oldExit], total_cnt: "1" }));
    vi.stubGlobal("fetch", fetcher);
    const observation = await observeActivity(activity, new AbortController().signal);
    const next = applyActivityPatch(activity, observation!.patch);
    expect(next.status).toBe("source_finality");
    expect(next.depositCount).toBeUndefined();
    expect(next.destinationTxHash).toBeUndefined();

    fetcher.mockResolvedValue(Response.json({ deposits: [
      { ...oldExit, deposit_cnt: 2, tx_hash: exitHash, claim_tx_hash: "", ready_for_claim: false }, oldExit,
    ], total_cnt: "2" }));
    const indexed = await observeActivity(next, new AbortController().signal);
    expect(applyActivityPatch(next, indexed!.patch)).toMatchObject({ status: "message_observed", depositCount: "2" });
  });

  it("keeps a known withdrawal pending when the indexer only returns someone else's claimed exit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ deposits: [
      { network_id: 73, dest_net: 0, deposit_cnt: 99, claim_tx_hash: `0x${"ab".repeat(32)}` },
    ] })));
    const activity: Activity = {
      id: "known-exit", provider: "agglayer", mode: "send", amount: "1", asset: "ETH",
      status: "source_finality", destination: "0x1111111111111111111111111111111111111111",
      depositCount: "42", updatedAt: 1, summary: "", eta: "Waiting", txHash: "",
      agglayerExitHashes: [`0x${"cd".repeat(32)}`],
    };
    const observation = await observeActivity(activity, new AbortController().signal);
    const next = applyActivityPatch(activity, observation!.patch);
    expect(next.status).toBe("source_finality");
    expect(next.depositCount).toBe("42");
    expect(next.destinationTxHash).toBeUndefined();
  });

  it("tracks Cardona network 73, excluding retired networks and other destinations", async () => {
    const exit = { network_id: 73, dest_net: 0, dest_addr: `0x${"aa".repeat(20)}`, deposit_cnt: 3,
      tx_hash: `0x${"ab".repeat(32)}`, claim_tx_hash: `0x${"ef".repeat(32)}` };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ deposits: [
      { ...exit, network_id: 1, deposit_cnt: 99 },
      { ...exit, network_id: 86, deposit_cnt: 100 },
      { ...exit, dest_net: 73, deposit_cnt: 101 },
      exit,
      { ...exit, deposit_cnt: 2, tx_hash: `0x${"cd".repeat(32)}` },
    ] })));
    expect(await findMidenToEvmDeposit(`0x${"aa".repeat(20)}`, [exit.tx_hash])).toEqual(exit);
    expect(await findMidenToEvmDeposit(`0x${"aa".repeat(20)}`, [`0x${"cd".repeat(32)}`])).toEqual({ ...exit, deposit_cnt: 2, tx_hash: `0x${"cd".repeat(32)}` });
  });

  it("returns null when only retired rollup rows are present", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ deposits: [
      { network_id: 78, dest_net: 0, deposit_cnt: 99 },
    ] })));
    expect(await findMidenToEvmDeposit(`0x${"aa".repeat(20)}`, [`0x${"ab".repeat(32)}`])).toBeNull();
  });
});
