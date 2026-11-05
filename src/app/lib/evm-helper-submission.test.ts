import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityStore } from "../../bridge/activity";
import { submitBridgeTransfer, type TransferSubmission, type SubmissionEffects } from "./bridge-submission";
import { activityPersistence, activityStorageKey } from "./bridge-persistence";
import { routesForEnvironment } from "../../bridge/core/routes";
import { EvmHelperJournal, evmJournalKey } from "../../bridge/providers/xreserve/helper-evm-journal";
import { evmManualAuthorizationSchema } from "../../bridge/providers/xreserve/helper-evm-types";
import { evmHelperCallData } from "../../bridge/providers/xreserve/helper-evm-call";
import { txHash, sender } from "../../bridge/providers/xreserve/fixtures/evm/test-fixture";
import golden from "../../bridge/providers/xreserve/fixtures/manual/solana-golden.json";
import { restoreEvmJournalReceipt } from "../../bridge/providers/xreserve/helper-evm-receipt";
vi.mock("../../config/cctp-evm-helper-public.json", async () => ({ default: (await import("../../bridge/providers/xreserve/fixtures/evm/deployment.json")).default }));
const { rpc, approvalWallet } = vi.hoisted(() => ({ rpc: { readContract: vi.fn(), simulateContract: vi.fn(), getBlockNumber: vi.fn(), getTransactionCount: vi.fn(), getBalance: vi.fn(), estimateContractGas: vi.fn(), getGasPrice: vi.fn(), waitForTransactionReceipt: vi.fn() }, approvalWallet: { writeContract: vi.fn() } }));
vi.mock("../../bridge/evm/deposit-wallet", () => ({ prepareDepositWallet: async () => ({ client: rpc, wallet: approvalWallet, assertWallet: async () => {} }) }));
vi.mock("../../bridge/evm/source-transaction", () => ({ captureSourceTransaction: async () => undefined, recoverSourceTransaction: async () => ({}) }));
beforeEach(() => { vi.clearAllMocks(); rpc.readContract.mockResolvedValue(1000000n); rpc.simulateContract.mockImplementation(async request => ({ request }));
  rpc.getBlockNumber.mockResolvedValue(100n); rpc.getTransactionCount.mockResolvedValue(3); rpc.getBalance.mockResolvedValue(10n ** 18n);
  rpc.estimateContractGas.mockResolvedValue(100000n); rpc.getGasPrice.mockResolvedValue(1n); approvalWallet.writeContract.mockResolvedValue(txHash); rpc.waitForTransactionReceipt.mockResolvedValue({ status: "success" }); });
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const storage = new Map<string, string>();
  const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }), removeItem: (key: string) => storage.delete(key) };
  vi.stubGlobal("window", { localStorage });
  let locked = false;
  vi.stubGlobal("navigator", { locks: { request: vi.fn(async (_name, _options, operation) => { if (locked) return operation(null); locked = true; try { return await operation({}); } finally { locked = false; } }) } });
  const route = routesForEnvironment("testnet").find(row => row.transport === "cctp-helper-evm" && row.source.network === "sepolia")!;
  const auth = evmManualAuthorizationSchema.parse({ runtime: "evm", execution: "manual", deployment: route.evmHelperDeployment!, deploymentId: route.evmHelperDeployment!.deploymentId,
    sourceAccount: sender, grossAmount: "1000000", maxCctpFee: "100", minimumNet: "999900", midenRecipient: golden.miden.bytes32, finality: 2000, checkedAt: new Date().toISOString() });
  const sourceIdentity = { runtime: "evm" as const, network: "sepolia" as const, address: sender };
  const provider = { request: vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_chainId") return "0xaa36a7"; if (method === "eth_accounts") return [sender]; if (method === "eth_sendTransaction") return txHash; throw new Error(method);
  }) };
  vi.stubGlobal("fetch", vi.fn(async () => { const { deployment: _d, finality: _f, ...quote } = auth; void _d; void _f; return Response.json(quote); }));
  const input: TransferSubmission = { environment: "testnet", routeId: route.id, amount: "1", insufficientBalance: false, evmBalance: "1", evmAddress: sender,
    midenAccount: golden.miden.accountHex, evmWallet: { connected: true, address: sender, provider: provider as unknown as import("../../wallets/evm/evm-wallet").EvmProvider }, midenWallet: { connected: true, address: golden.miden.accountHex }, midenAsset: null,
    sourceIdentity, helperAttemptId: crypto.randomUUID(), quote: { kind: "cctp-helper-evm", authorization: auth, received: "0.9999", fee: "0.0001", validity: { kind: "provider" },
      request: { routeId: route.id, recovery: route.recovery, amount: "1", midenAccount: golden.miden.accountHex, evmAddress: sender, sourceIdentity } } };
  const store = new ActivityStore(activityPersistence); store.sync();
  const effects: SubmissionEffects = { activities: store, openEvmWallet: vi.fn(), verifyBalanceCap: vi.fn(async () => {}), onError: vi.fn(), onSubmittingChange: vi.fn(), onPhaseChange: vi.fn(), navigate: vi.fn() };
  const sends = () => provider.request.mock.calls.filter(([r]) => r.method === "eth_sendTransaction");
  return { input, effects, storage, localStorage, store, provider, sends, auth };
}
describe("actual native EVM wallet boundary and durable admission", () => {
  it("saves before the one eth_sendTransaction and sends the exact native Circle call", async () => {
    const f = setup();
    f.provider.request.mockImplementation(async ({ method }) => { if (method === "eth_chainId") return "0xaa36a7"; if (method === "eth_sendTransaction") {
      expect(new EvmHelperJournal().read()[0].stage).toBe("wallet_pending"); expect(f.store.getSnapshot().receipts[0].unsavedChanges).toBeUndefined(); return txHash;
    } throw new Error(method); });
    await submitBridgeTransfer(f.input, f.effects);
    expect(f.sends()).toHaveLength(1);
    const call = f.sends()[0][0] as unknown as { params: [{ data: string; to: string; nonce: string; value?: string }] };
    expect(call.params[0]).toMatchObject({ data: evmHelperCallData(f.auth), to: f.auth.deployment.source.tokenMessenger.address, nonce: "0x3" });
    expect(BigInt(call.params[0].value ?? "0x0")).toBe(0n);
    expect(new EvmHelperJournal().read()[0]).toMatchObject({ hash: txHash, hashOrigin: "wallet", stage: "source_unknown" });
  });
  it.each([true, false])("reserves same canonical intent across simultaneous stores, same attempt %s", async same => {
    const f = setup(), second = new ActivityStore(activityPersistence); second.sync(); let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; }); rpc.simulateContract.mockImplementationOnce(async request => { await barrier; return { request }; });
    const first = submitBridgeTransfer(f.input, f.effects);
    const other = submitBridgeTransfer({ ...f.input, amount: "1.0", helperAttemptId: same ? f.input.helperAttemptId : crypto.randomUUID() }, { ...f.effects, activities: second });
    await vi.waitFor(() => expect(rpc.simulateContract).toHaveBeenCalledTimes(1)); release(); await Promise.all([first, other]);
    expect(f.sends()).toHaveLength(1);
    const reload = new ActivityStore(activityPersistence); reload.sync();
    await submitBridgeTransfer({ ...f.input, helperAttemptId: crypto.randomUUID() }, { ...f.effects, activities: reload }); expect(f.sends()).toHaveLength(1);
  });
  it("unknown wallet errors remain durable and are never retried", async () => {
    const f = setup(); f.provider.request.mockRejectedValue(new Error("lost wallet response"));
    await submitBridgeTransfer(f.input, f.effects); await submitBridgeTransfer({ ...f.input, helperAttemptId: crypto.randomUUID() }, f.effects);
    expect(new EvmHelperJournal().read()[0].stage).toBe("source_unknown"); expect(f.provider.request).toHaveBeenCalledTimes(1);
  });
  it("preserves known wallet hash after ordinary receipt writes fail", async () => {
    const f = setup(); f.provider.request.mockImplementation(async ({ method }) => { if (method === "eth_sendTransaction") {
      f.localStorage.setItem.mockImplementation((key, value) => { if (key === activityStorageKey) throw new Error("receipt storage full"); f.storage.set(key, value); }); return txHash;
    } if (method === "eth_chainId") return "0xaa36a7"; throw new Error(method); });
    await submitBridgeTransfer(f.input, f.effects);
    expect(new EvmHelperJournal().read()[0].hash).toBe(txHash);
    await submitBridgeTransfer({ ...f.input, helperAttemptId: crypto.randomUUID() }, f.effects); expect(f.sends()).toHaveLength(1);
    f.storage.delete(activityStorageKey);
    const restored = restoreEvmJournalReceipt(new EvmHelperJournal().read()[0]);
    expect(restored.sourceTxHash).toBe(txHash); expect(restored.midenAccount).toBe(golden.miden.accountHex); expect(restored.routeSnapshot?.disabled).toBe(true);
  });
  it("stops before wallet for failed journal readback or zero native gas", async () => {
    const f = setup(); const get = f.localStorage.getItem;
    f.localStorage.setItem.mockImplementation((key, value) => { f.storage.set(key, value); if (key === evmJournalKey) f.localStorage.getItem = key => key === evmJournalKey ? "[]" : get(key); });
    await submitBridgeTransfer(f.input, f.effects); expect(f.sends()).toHaveLength(0);
    f.localStorage.getItem = get; f.storage.clear(); rpc.getBalance.mockResolvedValue(0n);
    await submitBridgeTransfer({ ...f.input, helperAttemptId: crypto.randomUUID() }, f.effects); expect(f.sends()).toHaveLength(0);
  });
  it.each(["intent", "callData", "deploymentId", "amount", "recipient", "failed-state", "duplicates"])("fails closed for an orphan journal with corrupt %s before another wallet call", async mutation => {
    const f = setup(); await submitBridgeTransfer(f.input, f.effects);
    const rows = JSON.parse(f.storage.get(evmJournalKey)!);
    if (mutation === "intent") rows[0].intent = "";
    if (mutation === "callData") rows[0].callData = "0x1234";
    if (mutation === "deploymentId") rows[0].authorization.deploymentId = "changed";
    if (mutation === "amount") rows[0].authorization.minimumNet = "999899";
    if (mutation === "recipient") rows[0].authorization.midenRecipient = `0x${"00".repeat(32)}`;
    if (mutation === "failed-state") rows[0].stage = "source_failed";
    if (mutation === "duplicates") rows.push(rows[0]);
    const corrupted = JSON.stringify(rows); f.storage.set(evmJournalKey, corrupted); f.storage.delete(activityStorageKey);
    const reloaded = new ActivityStore(activityPersistence); reloaded.sync();
    await submitBridgeTransfer({ ...f.input, helperAttemptId: crypto.randomUUID() }, { ...f.effects, activities: reloaded });
    expect(f.sends()).toHaveLength(1); expect(f.storage.get(evmJournalKey)).toBe(corrupted);
  });
  it("approves the native messenger for the gross burn amount, then confirms allowance before burn", async () => {
    const f = setup(); rpc.readContract.mockResolvedValueOnce(0n).mockResolvedValue(1000000n);
    await submitBridgeTransfer(f.input, f.effects);
    expect(approvalWallet.writeContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "approve", address: f.auth.deployment.source.usdc.address,
      args: [f.auth.deployment.source.tokenMessenger.address, 1000000n] }));
    expect(f.sends()).toHaveLength(1);
  });
});
