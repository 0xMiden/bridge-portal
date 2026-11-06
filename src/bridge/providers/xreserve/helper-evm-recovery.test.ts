import { describe, expect, it } from "vitest";
import { applyEvmObservation } from "./helper-evm-recovery";
import { evmRow, blockHash, txHash } from "./fixtures/evm/test-fixture";
import { EvmHelperJournal, evmJournalKey } from "./helper-evm-journal";
import { evmHelperIntent } from "./helper-evm-call";
describe("durable EVM economic locks and conservative recovery", () => {
  it("locks canonical raw-unit intent across journal instances and reload", () => {
    const map = new Map<string, string>(), storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
    const row = evmRow(); new EvmHelperJournal(storage).save(row);
    const reloaded = new EvmHelperJournal(storage);
    expect(() => reloaded.assertNew(crypto.randomUUID(), row.intent)).toThrow("Do not burn again");
    expect(evmHelperIntent({ ...row.authorization, grossAmount: "01000000" })).toBe(row.intent);
    map.set(evmJournalKey, "broken"); expect(() => reloaded.assertNew("new", row.intent)).toThrow();
  });
  it("keeps an imported failed hash unresolved and preserves earlier successful evidence", () => {
    const failure = { state: "source_failed", hash: txHash, blockNumber: "101", blockHash };
    const row = evmRow();
    expect(applyEvmObservation({ ...row, hashOrigin: "imported" }, failure).stage).toBe("needs_attention");
    expect(applyEvmObservation(row, failure).stage).toBe("source_failed");
    expect(() => applyEvmObservation(row, { ...failure, blockNumber: "99" })).toThrow();
    expect(() => applyEvmObservation(row, { ...failure, hash: `0x${"01".repeat(32)}` })).toThrow();
  });
  it("never converts pending/unavailable evidence into failed or complete", () => {
    for (const stage of ["wallet_pending", "source_unknown", "source_finalized", "ready"] as const) {
      const next = applyEvmObservation({ ...evmRow(), stage }, { state: "pending" });
      expect(["source_unknown", "needs_attention"]).toContain(next.stage);
      expect(next.hash).toBe(txHash);
    }
  });
});
