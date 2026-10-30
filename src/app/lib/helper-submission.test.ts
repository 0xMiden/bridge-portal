import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Transaction } from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";
import { ActivityStore, applyActivityPatch } from "../../bridge/activity";
import { activityPersistence, activityStorageKey, loadManualSubmissionActivities, loadStoredActivities } from "./bridge-persistence";
import { submitBridgeTransfer, type TransferSubmission, type SubmissionEffects } from "./bridge-submission";
import { routesForEnvironment } from "../../bridge/core/routes";
import { authorization, deployment, event, owner, signedFixture } from "../../bridge/providers/xreserve/fixtures/manual/test-fixture";
import { prepareHelperSolana } from "../../bridge/providers/xreserve/helper-solana";
import { observeManualHelper, resendManualHelper } from "../../bridge/providers/xreserve/helper-manual";
import golden from "../../bridge/providers/xreserve/fixtures/manual/solana-golden.json";
import { createActivity } from "./bridge-presentation";

vi.mock("../../config/cctp-helper-public.json", async () => ({ default: (await import("../../bridge/providers/xreserve/fixtures/manual/deployment.json")).default }));
const { rpc } = vi.hoisted(() => ({ rpc: { getGenesisHash: vi.fn(), getBlockHeight: vi.fn(), sendRawTransaction: vi.fn() } }));
vi.mock("../../bridge/solana/rpc", async original => ({ ...await original<typeof import("../../bridge/solana/rpc")>(), createSolanaConnection: () => rpc }));
vi.mock("../../bridge/providers/xreserve/helper-solana", async original => ({ ...await original<typeof import("../../bridge/providers/xreserve/helper-solana")>(), prepareHelperSolana: vi.fn() }));

beforeEach(() => { vi.clearAllMocks(); rpc.getGenesisHash.mockResolvedValue(deployment.source.genesisHash); rpc.getBlockHeight.mockResolvedValue(100);
  rpc.sendRawTransaction.mockImplementation(async (bytes: Uint8Array) => utils.bytes.bs58.encode(Transaction.from(bytes).signature!)); });
afterEach(() => vi.unstubAllGlobals());

async function setup(failWrite = 0) {
  const auth = authorization(), fixture = await signedFixture(auth), partial = Transaction.from(fixture.transaction.serialize());
  partial.signatures.find(entry => entry.publicKey.equals(owner.publicKey))!.signature = null;
  const prepared = { transaction: partial, eventAccount: event.publicKey.toBase58(), scanStartSlot: "100", blockhash: partial.recentBlockhash!, lastValidBlockHeight: "200", sourceFeeLamports: "5000", eventRentLamports: "1000000" };
  vi.mocked(prepareHelperSolana).mockResolvedValue(prepared);
  let writes = 0;
  const storage = new Map<string, string>();
  const provider = { isPhantom: true, isConnected: true, publicKey: owner.publicKey, connect: vi.fn(), disconnect: vi.fn(),
    signTransaction: vi.fn(async (transaction: Transaction) => { transaction.partialSign(owner); return transaction; }) };
  let locked = false;
  const requestLock = vi.fn(async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<unknown>) => {
    if (locked) return callback(null);
    locked = true;
    try { return await callback({ name: _name }); } finally { locked = false; }
  });
  vi.stubGlobal("navigator", { locks: { request: requestLock } });
  vi.stubGlobal("window", { phantom: { solana: provider }, localStorage: {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { if (++writes === failWrite) throw new Error("Storage full"); storage.set(key, value); },
  } });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...auth, deployment: undefined, finality: undefined, checkedAt: new Date().toISOString() })));
  const route = routesForEnvironment("testnet").find(value => value.transport === "cctp-helper")!;
  const sourceIdentity = { runtime: "solana" as const, network: "solana-devnet" as const, address: auth.sourceAccount };
  const input: TransferSubmission = { environment: "testnet", routeId: route.id, amount: "1", insufficientBalance: false, evmBalance: "", evmAddress: "", midenAccount: golden.miden.accountHex,
    evmWallet: { connected: false, address: "" }, midenWallet: { connected: true, address: golden.miden.accountHex }, midenAsset: null, sourceIdentity,
    solanaWallet: { provider, address: auth.sourceAccount }, helperAttemptId: crypto.randomUUID(),
    quote: { kind: "cctp-helper", authorization: auth, sourceFeeLamports: "5000", eventRentLamports: "1000000", received: "0.9999", fee: "0.0001", validity: { kind: "time", expiresAt: Date.now() + 30_000 },
      request: { routeId: route.id, recovery: route.recovery, amount: "1", evmAddress: "", midenAccount: golden.miden.accountHex, sourceIdentity } } };
  const store = new ActivityStore(activityPersistence); store.sync();
  const effects: SubmissionEffects = { activities: store, openEvmWallet: vi.fn(), verifyBalanceCap: vi.fn(async () => {}), onError: vi.fn(), onSubmittingChange: vi.fn(), onPhaseChange: vi.fn(), navigate: vi.fn() };
  return { input, effects, store, provider, storage, fixture, prepared, requestLock };
}

describe("actual ActivityStore acknowledgment and manual reentry", () => {
  it.each(["missing", "rejected", "unsupported"])("stops on %s Phantom sign-only without a broadcast fallback", async behavior => {
    const { input, effects, provider } = await setup();
    if (behavior === "missing") Reflect.deleteProperty(provider, "signTransaction");
    else provider.signTransaction.mockRejectedValueOnce({ code: behavior === "unsupported" ? -32601 : 4001 });
    await submitBridgeTransfer(input, effects);
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled(); expect(effects.onError).toHaveBeenCalled();
  });
  it("does not describe an unknown Phantom signing failure as rejection", async () => {
    const { input, effects, provider, store } = await setup();
    provider.signTransaction.mockRejectedValueOnce(new Error("Wallet disconnected during signing"));
    await submitBridgeTransfer(input, effects);
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
    expect(effects.onError).toHaveBeenCalledWith(expect.stringContaining("did not return a verified transaction"));
    expect(effects.onError).not.toHaveBeenCalledWith(expect.stringContaining("rejected"));
    expect(store.getSnapshot().receipts[0].activity.cctpHelper?.stage).toBe("signing");
    await submitBridgeTransfer({ ...input, helperAttemptId: crypto.randomUUID() }, effects);
    expect(provider.signTransaction).toHaveBeenCalledTimes(1);
  });
  it.each(["source_finalized", "ready"] as const)("blocks another burn while %s is waiting for manual completion", async stage => {
    const { input, effects, provider, store } = await setup();
    await submitBridgeTransfer(input, effects);
    const saved = store.getSnapshot().receipts[0].activity;
    store.patch(saved.id, { cctpHelper: { ...saved.cctpHelper!, stage, signedBytes: undefined } });
    const reloaded = new ActivityStore(activityPersistence); reloaded.sync();
    for (const amount of ["1", "1.0", "1.000000"]) {
      await submitBridgeTransfer({ ...input, amount, helperAttemptId: crypto.randomUUID() }, { ...effects, activities: reloaded });
    }
    expect(provider.signTransaction).toHaveBeenCalledTimes(1);
    expect(prepareHelperSolana).toHaveBeenCalledTimes(1);
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(effects.navigate).toHaveBeenLastCalledWith(`/activity/${saved.id}`);
    expect(effects.onError).toHaveBeenLastCalledWith(expect.stringContaining("Recover the existing source attempt"));
  });
  it.each(["account", "provider", "recipient", "message", "event-signature"])("rechecks %s after the wallet dialog", async behavior => {
    const { input, effects, provider } = await setup();
    input.assertCurrentWallets = () => { if (input.midenWallet.address !== input.midenAccount) throw new Error("Bread account changed"); };
    provider.signTransaction.mockImplementationOnce(async tx => {
      if (behavior === "account") provider.publicKey = event.publicKey;
      if (behavior === "provider") window.phantom = { solana: { ...provider } };
      if (behavior === "recipient") input.midenWallet.address = "changed";
      if (behavior === "message") tx.recentBlockhash = event.publicKey.toBase58();
      tx.partialSign(owner);
      if (behavior === "event-signature") tx.signatures.find(value => value.publicKey.equals(event.publicKey))!.signature = Buffer.alloc(64);
      return tx;
    });
    await submitBridgeTransfer(input, effects);
    expect(provider.signTransaction).toHaveBeenCalledTimes(1); expect(rpc.sendRawTransaction).not.toHaveBeenCalled(); expect(effects.onError).toHaveBeenCalled();
  });
  it.each([-1, 201, Number.MAX_SAFE_INTEGER + 1])("does not sign at invalid current height %s", async height => {
    const { input, effects, provider } = await setup(); rpc.getBlockHeight.mockResolvedValue(height);
    await submitBridgeTransfer(input, effects); expect(provider.signTransaction).not.toHaveBeenCalled(); expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("a fee increase requires review before the wallet request", async () => {
    const { input, effects, provider, prepared } = await setup();
    vi.mocked(prepareHelperSolana).mockResolvedValue({ ...prepared, sourceFeeLamports: "5001" });
    await submitBridgeTransfer(input, effects); expect(provider.signTransaction).not.toHaveBeenCalled(); expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("post-send storage failure retains the durable signature and never labels delivery complete", async () => {
    const { input, effects, store, provider } = await setup(4);
    await submitBridgeTransfer(input, effects);
    expect(provider.signTransaction).toHaveBeenCalledTimes(1); expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().receipts[0].unsavedChanges).toBeDefined();
    const saved = loadStoredActivities()[0]; expect(saved.cctpHelper?.signature).toBeDefined(); expect(saved.status).toBe("source_finality");
    await submitBridgeTransfer({ ...input, helperAttemptId: crypto.randomUUID() }, effects);
    expect(provider.signTransaction).toHaveBeenCalledTimes(1); expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])("reserves before preparation for concurrent calls, sameAttempt=%s", async sameAttempt => {
    const { input, effects, store, provider, prepared } = await setup();
    const secondStore = new ActivityStore(activityPersistence); secondStore.sync();
    let release!: () => void, entered = 0;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(prepareHelperSolana).mockImplementation(async () => { entered++; await barrier; return prepared; });
    const first = submitBridgeTransfer(input, effects);
    const second = submitBridgeTransfer({ ...input, amount: "1.0", helperAttemptId: sameAttempt ? input.helperAttemptId : crypto.randomUUID() }, { ...effects, activities: secondStore });
    await vi.waitFor(() => expect(entered).toBe(1));
    release(); await Promise.all([first, second]);
    expect(entered).toBe(1); expect(provider.signTransaction).toHaveBeenCalledTimes(1); expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().receipts).toHaveLength(1);
    // This store was created before the first save; fresh durable history must still block it.
    await submitBridgeTransfer({ ...input, helperAttemptId: crypto.randomUUID() }, { ...effects, activities: secondStore });
    expect(provider.signTransaction).toHaveBeenCalledTimes(1); expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("fails closed without Web Locks, and releases reservations after error", async () => {
    const { input, effects, provider, requestLock } = await setup();
    vi.stubGlobal("navigator", {});
    await submitBridgeTransfer(input, effects);
    expect(provider.signTransaction).not.toHaveBeenCalled(); expect(prepareHelperSolana).not.toHaveBeenCalled();
    expect(effects.onError).toHaveBeenCalledWith(expect.stringContaining("Web Locks"));
    vi.stubGlobal("navigator", { locks: { request: requestLock } });
    await submitBridgeTransfer(input, effects);
    expect(provider.signTransaction).toHaveBeenCalledTimes(1);
  });
  it("an occupied origin lock blocks even a different economic intent", async () => {
    const { input, effects, provider, requestLock } = await setup();
    requestLock.mockImplementationOnce(async (_name, _options, callback) => callback(null));
    await submitBridgeTransfer(input, effects);
    expect(provider.signTransaction).not.toHaveBeenCalled(); expect(prepareHelperSolana).not.toHaveBeenCalled();
    expect(effects.onError).toHaveBeenCalledWith(expect.stringContaining("Another tab"));
  });
  it.each(["invalid-json", "invalid-manual-row", "read-failed"])("does not discard %s as proof of no earlier attempt", async reason => {
    const { input, effects, storage, provider } = await setup();
    if (reason === "invalid-json") storage.set(activityStorageKey, "{");
    if (reason === "invalid-manual-row") storage.set(activityStorageKey, JSON.stringify([{ routeSnapshot: { transport: "cctp-helper" }, cctpHelper: { stage: "signed" } }]));
    if (reason === "read-failed") window.localStorage.getItem = () => { throw new Error("Storage read failed"); };
    await submitBridgeTransfer(input, effects);
    expect(provider.signTransaction).not.toHaveBeenCalled(); expect(prepareHelperSolana).not.toHaveBeenCalled(); expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
    expect(effects.onError).toHaveBeenCalled();
  });
  it("retains the authoritative strict read if a stale store's subsequent sync read fails", async () => {
    const { input, effects, provider, storage } = await setup();
    const stale = new ActivityStore(activityPersistence); stale.sync();
    await submitBridgeTransfer(input, effects);
    let reads = 0;
    window.localStorage.getItem = key => { if (++reads > 1) throw new Error("Second read failed"); return storage.get(key) ?? null; };
    await submitBridgeTransfer({ ...input, helperAttemptId: crypto.randomUUID() }, { ...effects, activities: stale });
    expect(provider.signTransaction).toHaveBeenCalledTimes(1); expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(effects.onError).toHaveBeenCalledWith(expect.stringContaining("Recover the existing source attempt"));
  });
  it.each(["missing-slot", "signed-bytes", "source-evidence", "bundle", "missing-signature", "wrong-source-hash"])
  ("inconsistent persisted failed source %s cannot authorize another burn", async mutation => {
    const { input, effects, provider, storage, fixture } = await setup();
    await submitBridgeTransfer(input, effects);
    const rows = JSON.parse(storage.get(activityStorageKey)!);
    const helper = rows[0].cctpHelper;
    helper.stage = "source_failed"; helper.failedSlot = "105"; delete helper.signedBytes;
    if (mutation === "missing-slot") delete helper.failedSlot;
    if (mutation === "signed-bytes") helper.signedBytes = fixture.transaction.serialize().toString("base64");
    if (mutation === "missing-signature") delete helper.signature;
    if (mutation === "wrong-source-hash") rows[0].sourceTxHash = "1".repeat(64);
    if (mutation === "source-evidence" || mutation === "bundle") {
      const { validateManualSource } = await import("../../bridge/solana/source-transaction");
      const { guardSolanaTransaction } = await import("../../bridge/solana/rpc");
      const source = await validateManualSource(guardSolanaTransaction(fixture.raw, fixture.signature), deployment);
      if (mutation === "source-evidence") helper.sourceEvidence = source;
      else {
        const { manualBundleSchema, MANUAL_PENDING } = await import("../../bridge/providers/xreserve/helper-types");
        helper.bundle = manualBundleSchema.parse({ schemaVersion: 1, execution: "manual", deployment, source,
          cctpNonce: `0x${"01".repeat(32)}`, message: source.message, attestation: `0x${"ab".repeat(65)}`,
          maxCctpFee: helper.authorization.maxCctpFee, feeExecuted: "0", netAmount: helper.authorization.grossAmount,
          checkedAt: new Date().toISOString(), simulationCaller: `0x${"77".repeat(20)}`,
          call: { to: deployment.helper.address, value: "0", function: "receiveAndDeposit(bytes,bytes)", data: "0x00" },
          notice: MANUAL_PENDING, revalidation: "The executor must independently revalidate and simulate this call before spending Arc gas." });
      }
    }
    storage.set(activityStorageKey, JSON.stringify(rows));
    expect(() => loadManualSubmissionActivities()).toThrow("invalid");
    const reloaded = new ActivityStore(activityPersistence); reloaded.sync();
    await submitBridgeTransfer({ ...input, helperAttemptId: crypto.randomUUID() }, { ...effects, activities: reloaded });
    expect(provider.signTransaction).toHaveBeenCalledTimes(1); expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("the canonical failure observation writes a valid failed receipt before a new explicit review", async () => {
    const { input, effects, store, provider } = await setup(); await submitBridgeTransfer(input, effects);
    const saved = store.getSnapshot().receipts[0].activity;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ state: "source_failed", sourceTransaction: saved.cctpHelper!.signature, slot: "105", error: "Instruction failed" })));
    const observed = await observeManualHelper(saved, new AbortController().signal);
    store.patch(saved.id, observed.patch);
    const [failed] = loadManualSubmissionActivities();
    expect(failed.cctpHelper).toMatchObject({ stage: "source_failed", signature: saved.cctpHelper!.signature, failedSlot: "105" });
    expect(failed.cctpHelper?.signedBytes).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...authorization(), deployment: undefined, finality: undefined, checkedAt: new Date().toISOString() })));
    const reloaded = new ActivityStore(activityPersistence); reloaded.sync();
    await submitBridgeTransfer({ ...input, helperAttemptId: crypto.randomUUID() }, { ...effects, activities: reloaded });
    expect(provider.signTransaction).toHaveBeenCalledTimes(2); expect(prepareHelperSolana).toHaveBeenCalledTimes(2);
  });
  it("unrelated ordinary activity writes cannot erase corrupted manual recovery evidence", async () => {
    const { input, effects, provider, storage } = await setup();
    await submitBridgeTransfer(input, effects);
    const rows = JSON.parse(storage.get(activityStorageKey)!);
    rows[0].cctpHelper.signature = "corrupt";
    const corrupt = JSON.stringify(rows); storage.set(activityStorageKey, corrupt);
    const other = new ActivityStore(activityPersistence); other.sync();
    expect(other.getSnapshot().receipts).toHaveLength(0);
    const route = routesForEnvironment("testnet").find(value => value.provider === "agglayer" && value.mode === "receive")!;
    const ordinary = other.record(createActivity(route, "2", {}));
    expect(other.get(ordinary.id)?.unsavedChanges).toBeDefined(); expect(storage.get(activityStorageKey)).toBe(corrupt);
    await submitBridgeTransfer({ ...input, helperAttemptId: crypto.randomUUID() }, { ...effects, activities: other });
    expect(provider.signTransaction).toHaveBeenCalledTimes(1); expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it.each([1, 2])("write failure%s blocks the next irreversible boundary and retry retains one attempt", async failWrite => {
    const { input, effects, store, provider, fixture } = await setup(failWrite);
    await submitBridgeTransfer(input, effects);
    expect(store.getSnapshot().receipts).toHaveLength(1);
    const receipt = store.getSnapshot().receipts[0]; expect(receipt.unsavedChanges).toBeDefined();
    expect(provider.signTransaction).toHaveBeenCalledTimes(failWrite === 1 ? 0 : 1);
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
    expect(effects.onError).toHaveBeenCalledWith(expect.not.stringContaining("Transfer submitted"));
    await submitBridgeTransfer(input, effects);
    expect(store.getSnapshot().receipts).toHaveLength(1); expect(store.get(receipt.activity.id)?.unsavedChanges).toBeUndefined();
    expect(provider.signTransaction).toHaveBeenCalledTimes(1); expect(prepareHelperSolana).toHaveBeenCalledTimes(1);
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(Buffer.from(rpc.sendRawTransaction.mock.calls[0][0])).toEqual(fixture.transaction.serialize());
  });
  it("lost send/reload preserves the original signature and prevents another signing request", async () => {
    const { input, effects, store, provider } = await setup();
    rpc.sendRawTransaction.mockRejectedValueOnce(new Error("Send timed out after acceptance"));
    await submitBridgeTransfer(input, effects);
    const saved = loadStoredActivities()[0]; expect(saved.cctpHelper?.signature).toBeDefined(); expect(saved.cctpHelper?.signedBytes).toBeDefined();
    expect(saved.status).toBe("source_finality");
    const reloaded = new ActivityStore(activityPersistence); reloaded.sync();
    for (const amount of ["1", "1.0", "1.000000"]) await submitBridgeTransfer({ ...input, amount, helperAttemptId: crypto.randomUUID() }, { ...effects, activities: reloaded });
    expect(provider.signTransaction).toHaveBeenCalledTimes(1); expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().receipts).toHaveLength(1);
  });
  it("expired signed bytes never authorize a replacement burn or resend", async () => {
    const { input, effects, store, provider } = await setup();
    rpc.sendRawTransaction.mockRejectedValueOnce(new Error("Unknown source outcome"));
    await submitBridgeTransfer(input, effects);
    rpc.getBlockHeight.mockResolvedValue(201);
    await expect(resendManualHelper(store.getSnapshot().receipts[0].activity, () => {})).rejects.toThrow("expired");
    expect(provider.signTransaction).toHaveBeenCalledTimes(1); expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("retains disabled historical snapshots and excludes malformed nested storage", async () => {
    const { input, effects, storage } = await setup(); await submitBridgeTransfer(input, effects);
    const rows = JSON.parse(storage.get(activityStorageKey)!);
    rows[0].routeSnapshot.disabled = true; storage.set(activityStorageKey, JSON.stringify(rows));
    expect(loadStoredActivities()).toHaveLength(1);
    rows[0].cctpHelper.signature = "NOT_A_SIGNATURE"; storage.set(activityStorageKey, JSON.stringify(rows));
    expect(loadStoredActivities()).toHaveLength(0);
  });
  it.each(["source_finalized", "ready"] as const)("surfaces current attention after %s while preserving source evidence", async stage => {
    const { input, effects, store } = await setup(); await submitBridgeTransfer(input, effects);
    const activity = store.getSnapshot().receipts[0].activity;
    const original = { ...activity, cctpHelper: { ...activity.cctpHelper!, stage } };
    const next = applyActivityPatch(original, { cctpHelper: { ...original.cctpHelper, stage: "needs_attention", reason: "attestation_invalid" } });
    expect(next.cctpHelper?.stage).toBe("needs_attention"); expect(next.cctpHelper?.signature).toBe(original.cctpHelper.signature);
    expect(next.status).toBe("source_finality");
  });
  it.each(["source_finalized", "ready"] as const)("revokes %s on HTTP validation failure without losing its signature", async stage => {
    const { input, effects, store } = await setup(); await submitBridgeTransfer(input, effects);
    const saved = store.getSnapshot().receipts[0].activity;
    const activity = { ...saved, cctpHelper: { ...saved.cctpHelper!, stage } };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Unavailable" }, { status: 503 })));
    const observation = await observeManualHelper(activity, new AbortController().signal);
    const next = applyActivityPatch(activity, observation.patch);
    expect(next.cctpHelper?.stage).toBe("needs_attention"); expect(next.cctpHelper?.signature).toBe(saved.cctpHelper?.signature);
  });
});
