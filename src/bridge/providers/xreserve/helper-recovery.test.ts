import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { helperDeployments } from "../../../config/cctp-helper";
import { recoverSolanaHelper } from "./helper-recovery";
import { helperActivitySchema, migrateHelperActivity } from "./helper-types";
import { validateManualSource } from "../../solana/source-transaction";
import { guardSolanaTransaction } from "../../solana/rpc";
import { deployment, signedFixture } from "./fixtures/manual/test-fixture";
import { loadManualSubmissionActivities, loadStoredActivities, activityStorageKey } from "../../../app/lib/bridge-persistence";
import { mergeHelperProgress } from "./helper-progress";
import { resendManualHelper } from "./helper-manual";
import { validateManualHelperAttestation } from "./helper-manual.server";

vi.mock("../../../config/cctp-helper-public.json", async () => ({ default: (await import("./fixtures/manual/deployment.json")).default }));
vi.mock("server-only", () => ({}));
let stored = "[]";
const fetchMock = vi.fn();
beforeEach(() => {
  stored = "[]"; vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { localStorage: { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } } });
  vi.stubGlobal("navigator", { locks: { request: async (_key: string, _options: unknown, operation: (lock: object) => unknown) => operation({}) } });
});
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const signed = await signedFixture();
  const source = await validateManualSource(guardSolanaTransaction(signed.raw, signed.signature), deployment);
  fetchMock.mockImplementation(async () => Response.json({ schemaVersion: 2, state: "source_verified", source }));
  const activity = await recoverSolanaHelper(deployment.deploymentId, signed.signature, []);
  return { source, signed, activity };
}

describe("normal Solana signature recovery and durable migration", () => {
  it("imports the original finalized recipient without fictitious signing/fee/rent metadata", async () => {
    const { source, signed, activity } = await fixture();
    expect(activity.cctpHelper).toMatchObject({ schemaVersion: 2, execution: "automatic", recoveryOnly: true,
      signature: signed.signature, sourceEvidence: source, eventAccount: source.eventAccount });
    expect(activity.midenAccount).toBe(`0x${source.midenRecipient.slice(34, 64)}`);
    for (const key of ["signedBytes", "blockhash", "lastValidBlockHeight", "sourceFeeLamports", "eventRentLamports"])
      expect(Object.hasOwn(activity.cctpHelper!, key)).toBe(false);
    expect(helperActivitySchema.safeParse(activity.cctpHelper).success).toBe(true);
    await expect(resendManualHelper(activity, vi.fn())).rejects.toThrow("no saved source bytes");
    const other = await recoverSolanaHelper(deployment.deploymentId, signed.signature, []);
    expect(other.id).not.toBe(activity.id);
    stored = JSON.stringify([activity]);
    expect(loadStoredActivities()).toHaveLength(1);
    expect(JSON.stringify(activity)).not.toMatch(/secretKey|privateKey|solanaRpc|arcRpc|irisApi/);
  });
  it.each(["pending", "source_failed", "needs_attention"])("does not import %s or discharge a separate unresolved attempt", async state => {
    const { signed, activity } = await fixture(), before = JSON.stringify(activity);
    fetchMock.mockImplementation(async () => Response.json(state === "pending" ? { state, reason: "source_unconfirmed" }
      : state === "source_failed" ? { state, sourceTransaction: signed.signature, slot: "105", error: "failed" }
        : { state, reason: "history_unavailable" }));
    await expect(recoverSolanaHelper(deployment.deploymentId, signed.signature, [activity])).rejects.toThrow("finalized successful");
    expect(JSON.stringify(activity)).toBe(before);
  });
  it("deduplicates the same transfer and restores a missing signature only when preserved event/terms match", async () => {
    const { signed, source, activity } = await fixture();
    expect((await recoverSolanaHelper(deployment.deploymentId, signed.signature, [activity])).id).toBe(activity.id);
    const helper = activity.cctpHelper!;
    const saved = { ...activity, cctpHelper: { ...helper, recoveryOnly: false, sourceEvidence: undefined, signature: undefined,
      stage: "signing" as const, scanStartSlot: "100", blockhash: signed.transaction.recentBlockhash!, lastValidBlockHeight: "200",
      sourceFeeLamports: "5000", eventRentLamports: "1000000", authorization: { ...helper.authorization, checkedAt: "2026-10-29T12:00:00.000Z" } } };
    const recovered = await recoverSolanaHelper(deployment.deploymentId, signed.signature, [saved]);
    expect(recovered.id).toBe(saved.id); expect(recovered.cctpHelper?.sourceEvidence).toEqual(source);
    expect(recovered.cctpHelper?.authorization.checkedAt).toBe(saved.cctpHelper.authorization.checkedAt);
    expect(recovered.cctpHelper?.sourceFeeLamports).toBe("5000");
    await expect(recoverSolanaHelper(deployment.deploymentId, signed.signature, [{ ...saved, cctpHelper: { ...saved.cctpHelper, signature: signed.signature,
      authorization: { ...saved.cctpHelper.authorization, grossAmount: "2000000" } } }])).rejects.toThrow("preserved");
  });
  it("does not fold an imported different event into an unresolved attempt", async () => {
    const { signed, activity } = await fixture();
    const unrelated = { ...activity, id: "separate", cctpHelper: { ...activity.cctpHelper!, signature: undefined,
      eventAccount: signed.authorization.sourceAccount, sourceEvidence: undefined } };
    const imported = await recoverSolanaHelper(deployment.deploymentId, signed.signature, [unrelated]);
    expect(imported.id).not.toBe(unrelated.id); expect(unrelated.cctpHelper.signature).toBeUndefined();
  });
  it("retains disabled historical deployments and rejects ambiguous saved matches", async () => {
    const { signed, activity } = await fixture();
    const entry = helperDeployments[0], enabled = entry.enabled;
    try {
      entry.enabled = false;
      expect((await recoverSolanaHelper(deployment.deploymentId, signed.signature, [activity])).id).toBe(activity.id);
      await expect(recoverSolanaHelper(deployment.deploymentId, signed.signature, [activity, { ...activity, id: "duplicate" }])).rejects.toThrow("Multiple saved");
    } finally { entry.enabled = enabled; }
  });
  it("explicitly migrates old ready to attested and never to delivered", async () => {
    const { signed, activity } = await fixture();
    const legacy = { ...activity.cctpHelper!, schemaVersion: 1 as const, execution: "manual" as const, recoveryOnly: false,
      stage: "ready" as const, blockhash: signed.transaction.recentBlockhash!, lastValidBlockHeight: "200", sourceFeeLamports: "5000", eventRentLamports: "1000000" };
    expect(migrateHelperActivity(legacy)).toMatchObject({ schemaVersion: 2, execution: "automatic", stage: "attested" });
    stored = JSON.stringify([{ ...activity, cctpHelper: legacy }]);
    expect(loadStoredActivities()[0]).toMatchObject({ status: "source_finality", cctpHelper: { stage: "attested", schemaVersion: 2 } });
  });
  it("malformed imported source evidence blocks a new burn even if the display drops it", async () => {
    const { activity } = await fixture();
    const corrupt = structuredClone(activity);
    corrupt.cctpHelper!.sourceEvidence!.grossAmount = "2000000";
    stored = JSON.stringify([corrupt]);
    expect(loadStoredActivities()).toEqual([]);
    expect(() => loadManualSubmissionActivities()).toThrow("history is invalid");
    expect(activityStorageKey).toBe("miden.bridge.ui.activities.v2");
  });
  it("merges late polls monotonically and retains the earliest preburn anchor", async () => {
    const { activity } = await fixture();
    const helper = { ...activity.cctpHelper!, stage: "arc_deposited" as const,
      authorization: { ...activity.cctpHelper!.authorization, arcAnchor: { block: "100", hash: `0x${"01".repeat(32)}` as const } },
      completion: { schemaVersion: 1 as const, stage: "arc_deposited" as const, catchingUp: false,
        arc: { transactionHash: `0x${"03".repeat(32)}` as const, block: "200", blockHash: `0x${"02".repeat(32)}` as const, helperLogIndex: 2, messageLogIndex: 0, reserveLogIndex: 1 } } };
    const stale = { ...helper, stage: "attested" as const, completion: { schemaVersion: 1 as const, stage: "attested" as const, catchingUp: true },
      authorization: { ...helper.authorization, arcAnchor: { block: "150", hash: `0x${"04".repeat(32)}` as const } } };
    expect(mergeHelperProgress(helper, stale)).toMatchObject({ accepted: true, helper: { stage: "arc_deposited", completion: { arc: helper.completion.arc }, authorization: { arcAnchor: helper.authorization.arcAnchor } } });
    expect(mergeHelperProgress(helper, { ...stale, signature: "1".repeat(64) })).toEqual({ accepted: false, helper });
  });
  it("accepts canonical lower cursor resets and refuses stale resets or stale copies of the corrupt hint", async () => {
    const { activity } = await fixture();
    const hash = (number: number) => `0x${number.toString(16).padStart(64, "0")}` as const;
    const corrupt = { nextBlock: "99999", checkpoint: { block: "99998", hash: hash(1) } };
    const helper = { ...activity.cctpHelper!, stage: "attested" as const,
      completion: { schemaVersion: 1 as const, stage: "attested" as const, catchingUp: true, scan: corrupt } };
    const reset = { nextBlock: "2001", checkpoint: { block: "2000", hash: hash(2000) }, resetFrom: corrupt };
    const repaired = mergeHelperProgress(helper, { ...helper, completion: { ...helper.completion, scan: reset } }).helper;
    expect(repaired.completion?.scan).toEqual(reset);
    const advanced = { nextBlock: "4001", checkpoint: { block: "4000", hash: hash(4000) }, resetFrom: corrupt };
    const current = mergeHelperProgress(repaired, { ...repaired, completion: { ...helper.completion, scan: advanced } }).helper;
    expect(mergeHelperProgress(current, helper).helper.completion?.scan).toEqual(advanced);
    expect(mergeHelperProgress(current, { ...helper, completion: { ...helper.completion, scan: reset } }).helper.completion?.scan).toEqual(advanced);
    expect(current.signature).toBe(helper.signature); expect(current.stage).toBe("attested");
  });
  it("drops malformed efficiency hints at storage load while preserving the source/bundle and burn lock", async () => {
    const { activity, source } = await fixture();
    let message = `${source.message.slice(0, 26)}${"1".padStart(64, "0")}${source.message.slice(90)}` as `0x${string}`;
    message = `${message.slice(0, 290)}${(2000).toString(16).padStart(8, "0")}${message.slice(298)}` as `0x${string}`;
    const bundle = await validateManualHelperAttestation(source, { sourceTxHash: source.sourceTransaction,
      messages: [{ status: "complete", message, attestation: `0x${"ab".repeat(65)}` }] }, deployment,
    { deploymentId: deployment.deploymentId, solanaRpc: "https://solana.example.invalid", arcRpc: "https://arc.example.invalid",
      irisApi: "https://iris-api-sandbox.circle.com", simulationCaller: "0x7777777777777777777777777777777777777777" }, false);
    stored = JSON.stringify([{ ...activity, cctpHelper: { ...activity.cctpHelper, stage: "attested", bundle,
      completion: { schemaVersion: 1, stage: "attested", catchingUp: true, scan: { nextBlock: "corrupt", checkpoint: {} } } } }]);
    const [loaded] = loadManualSubmissionActivities();
    expect(loaded.cctpHelper?.signature).toBe(source.sourceTransaction);
    expect(loaded.cctpHelper?.bundle?.message).toBe(message);
    expect(loaded.cctpHelper?.completion?.scan).toBeUndefined();
    expect(loaded.cctpHelper?.stage).toBe("attested");
  });
});
