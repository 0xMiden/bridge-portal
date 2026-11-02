import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Transaction } from "@solana/web3.js";
import { startFixtureServices } from "../../../../e2e/helper/services.mjs";
import type { HelperServer } from "../../../config/cctp-helper.server";
import { authorization, deployment, event, owner, signedFixture } from "./fixtures/manual/test-fixture";
import { manualApi, quoteManualHelper, readManualHelperTransfer } from "./helper-manual.server";
import { POST as sourceRpc } from "../../../app/api/cctp-helper/manual/rpc/route";
import { observeManualHelper, resendManualHelper, submitManualHelper } from "./helper-manual";
import { createActivity } from "../../../app/lib/bridge-presentation";
import { routesForEnvironment } from "../../core/routes";
import golden from "./fixtures/manual/solana-golden.json";
import { helperActivitySchema } from "./helper-types";
import type { SubmissionContext } from "../../core/submission";

vi.mock("server-only", () => ({}));
vi.mock("../../../config/cctp-helper-public.json", async () => ({ default: (await import("./fixtures/manual/deployment.json")).default }));
const registry = vi.hoisted(() => ({ server: undefined as HelperServer | undefined }));
vi.mock("../../../config/cctp-helper.server", () => ({ helperServer: () => ({ deployment, server: registry.server! }) }));
// Mock only registry selection. All preflight, codecs, real RPC transports and simulations execute.
let services: Awaited<ReturnType<typeof startFixtureServices>>, directory: string;
const nativeFetch = globalThis.fetch;
const input = () => { const auth = authorization(); return { deploymentId: auth.deploymentId, sourceDomain: 5, sourceAccount: auth.sourceAccount, grossAmount: auth.grossAmount, midenRecipient: auth.midenRecipient }; };
async function change(value: object) {
  const response = await nativeFetch(`${services.controlUrl}/scenario`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  expect(response.ok).toBe(true);
}
async function state(): Promise<{ sends: { signature: string; bytes: string }[]; simulations: unknown[]; calls: { kind: string; method: string; params: unknown[] }[] }> {
  return (await nativeFetch(`${services.controlUrl}/state`)).json();
}
async function sourceRequest(method: "sendTransaction" | "simulateTransaction", bytes: string) {
  return sourceRpc(new Request(`http://localhost/api/cctp-helper/manual/rpc?deploymentId=${deployment.deploymentId}`, { method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [bytes, method === "sendTransaction"
      ? { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }
      : { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" }] }) }));
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "miden-fee-policy-"));
  services = await startFixtureServices({ fixtureRoot: process.cwd(), runRoot: directory });
  registry.server = { deploymentId: deployment.deploymentId, ...services.endpoints, simulationCaller: `0x${"77".repeat(20)}` };
});
beforeEach(async () => { await nativeFetch(`${services.controlUrl}/reset`, { method: "POST", body: "{}" }); });
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await services?.close(); await rm(directory, { recursive: true, force: true }); });

describe("phase-specific Circle fee-recipient admission through actual production paths", () => {
  it.each(["0.1", "0"])("admits ordinary fee recipient with current fee %s", async feeBps => {
    await change({ feeBps }); const quote = await quoteManualHelper(input());
    expect(quote.maxCctpFee).toBe(feeBps === "0" ? "0" : "10");
  });
  it.each(["0.1", "0"])("rejects new quote for helper fee recipient even with current fee %s", async feeBps => {
    await change({ feeBps, feeRecipient: deployment.helper.address });
    await expect(quoteManualHelper(input())).rejects.toThrow("fee recipient");
    expect((await state()).sends).toHaveLength(0);
  });
  it("actual SDK initial send and identical-byte retry admit only supported policy and normalize omitted false", async () => {
    const auth = authorization(), route = routesForEnvironment("testnet").find(value => value.transport === "cctp-helper")!;
    const provider = { isPhantom: true, isConnected: true, publicKey: owner.publicKey, connect: vi.fn(), disconnect: vi.fn(),
      signTransaction: vi.fn(async (transaction: Transaction) => { transaction.partialSign(owner); return transaction; }) };
    const sourceIdentity = { runtime: "solana" as const, network: deployment.source.network, address: auth.sourceAccount };
    let saved = createActivity(route, "1");
    const save: SubmissionContext["record"] = vi.fn(patch => { saved = { ...saved, ...patch }; return saved; });
    vi.stubGlobal("window", { phantom: { solana: provider }, location: { origin: "http://bridge.invalid" } });
    vi.stubGlobal("navigator", { locks: { request: async (_name: string, _options: unknown, run: (lock: object) => Promise<unknown>) => run({}) } });
    const outgoing: unknown[] = [];
    vi.stubGlobal("fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(url) === "/api/cctp-helper/manual/quote") return manualApi(() => quoteManualHelper(JSON.parse(String(init?.body))));
      if (String(url).startsWith("http://bridge.invalid/")) {
        const wire = JSON.parse(String(init?.body)); if (wire.method === "sendTransaction") outgoing.push(wire.params[1]);
        return sourceRpc(new Request(url, init));
      }
      return nativeFetch(url, init);
    });
    await change({ feeBps: "0", feeRecipient: deployment.helper.address });
    const context: SubmissionContext = { route, input: { environment: "testnet", routeId: route.id, amount: "1", insufficientBalance: false,
      evmBalance: "", evmAddress: "", midenAccount: golden.miden.accountHex, midenAsset: null, sourceIdentity,
      evmWallet: { connected: false, address: "" }, midenWallet: { connected: true, address: golden.miden.accountHex },
      solanaWallet: { provider, address: auth.sourceAccount }, helperAttemptId: "new-fee-policy-attempt",
      quote: { kind: "cctp-helper", authorization: auth, received: "0.9999", fee: "0.0001", sourceFeeLamports: "10000", eventRentLamports: "4315200",
        validity: { kind: "time", expiresAt: Date.now() + 30000 }, request: { routeId: route.id, recovery: route.recovery, amount: "1",
          evmAddress: "", midenAccount: golden.miden.accountHex, sourceIdentity } } }, phase: vi.fn(), update: vi.fn(), record: save, saveHelperDurably: save };
    await expect(submitManualHelper(context)).rejects.toThrow();
    expect(provider.signTransaction).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    expect((await state()).sends).toHaveLength(0); expect((await state()).simulations).toHaveLength(0);
    await change({ feeRecipient: `0x${"88".repeat(20)}` });
    await submitManualHelper(context);
    const first = (await state()).sends[0]; expect(first).toBeDefined();
    await resendManualHelper(saved, save);
    const actual = await state();
    expect(actual.sends).toEqual([first, first]); expect(provider.signTransaction).toHaveBeenCalledTimes(1);
    expect(outgoing).toEqual(Array(2).fill({ encoding: "base64", preflightCommitment: "confirmed", maxRetries: 0 }));
    expect(actual.calls.filter(call => call.kind === "solana" && call.method === "sendTransaction").map(call => call.params[1]))
      .toEqual(Array(2).fill({ encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }));
  });
  it.each(["error", "malformed", "zero"])("fails closed on %s fee getter for quote and direct source admission", async failure => {
    await change(failure === "zero" ? { feeRecipient: `0x${"00".repeat(20)}` } : { feeRecipientResult: failure });
    await expect(quoteManualHelper(input())).rejects.toThrow();
    const signed = await signedFixture(), response = await sourceRequest("sendTransaction", signed.transaction.serialize().toString("base64"));
    expect(response.status).toBe(503); expect((await state()).sends).toHaveLength(0);
  });
  it.each(["sendTransaction", "simulateTransaction"] as const)("a cached positive-cap transaction cannot bypass %s via the proxy under a zero quote", async method => {
    const quote = await quoteManualHelper(input()); expect(BigInt(quote.maxCctpFee)).toBeGreaterThan(0n);
    const signed = await signedFixture();
    await change({ feeBps: "0", feeRecipient: deployment.helper.address });
    const response = await sourceRequest(method, signed.transaction.serialize().toString("base64"));
    expect(response.status).toBe(503); expect((await state()).sends).toHaveLength(0); expect((await state()).simulations).toHaveLength(0);
  });
  it.each([true, null, 0, "false"])("rejects unsafe or malformed skipPreflight=%s without upstream send", async skipPreflight => {
    const signed = await signedFixture();
    const response = await sourceRpc(new Request(`http://localhost/api/cctp-helper/manual/rpc?deploymentId=${deployment.deploymentId}`, { method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [signed.transaction.serialize().toString("base64"),
        { encoding: "base64", skipPreflight, preflightCommitment: "confirmed", maxRetries: 0 }] }) }));
    expect(response.status).toBe(400); expect((await state()).sends).toHaveLength(0);
  });
  it("saved positive cap plus refreshed zero fee cannot resend while self recipient; restored policy resends identical bytes only", async () => {
    const signed = await signedFixture(), bytes = signed.transaction.serialize().toString("base64");
    const route = routesForEnvironment("testnet").find(value => value.transport === "cctp-helper")!;
    const activity = createActivity(route, "1", { solanaAddress: signed.authorization.sourceAccount, midenAccount: golden.miden.accountHex,
      cctpHelper: { schemaVersion: 1, execution: "manual", authorization: signed.authorization, attemptId: "positive-cap-saved", stage: "source_unknown",
        eventAccount: event.publicKey.toBase58(), scanStartSlot: "100", blockhash: signed.transaction.recentBlockhash!, lastValidBlockHeight: "200",
        signature: signed.signature, signedBytes: bytes, sourceFeeLamports: "5000", eventRentLamports: "1000000" } });
    const unchanged = JSON.stringify(activity), save = vi.fn();
    vi.stubGlobal("window", { location: { origin: "http://bridge.invalid" } });
    vi.stubGlobal("navigator", { locks: { request: async (_name: string, _options: unknown, run: (lock: object) => Promise<unknown>) => run({}) } });
    vi.stubGlobal("fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(url) === "/api/cctp-helper/manual/quote") return manualApi(() => quoteManualHelper(JSON.parse(String(init?.body))));
      if (String(url).startsWith("http://bridge.invalid/")) {
        const response = await sourceRpc(new Request(url, init));
        if (!response.ok) throw new Error(`Rejected source RPC ${String(init?.body)}: ${await response.text()}`);
        return response;
      }
      return nativeFetch(url, init);
    });
    await change({ feeBps: "0", feeRecipient: deployment.helper.address });
    await expect(resendManualHelper(activity, save)).rejects.toThrow();
    expect(save).not.toHaveBeenCalled(); expect((await state()).sends).toHaveLength(0); expect(JSON.stringify(activity)).toBe(unchanged);
    await change({ feeRecipient: `0x${"88".repeat(20)}` });
    await resendManualHelper(activity, save);
    expect((await state()).sends).toEqual([{ signature: signed.signature, bytes }]); expect(JSON.stringify(activity)).toBe(unchanged);
  });
  it.each([
    { functionName: "paused", target: deployment.arc.gatewayWallet.address, value: true },
    { functionName: "paused", target: deployment.arc.gatewayMinter.address, value: true },
    { functionName: "isTokenSupported", target: deployment.arc.gatewayWallet.address, value: false },
    { functionName: "isDenylisted", principal: deployment.arc.xReserve.address, value: true },
    { functionName: "isDenylisted", principal: deployment.miden.remoteDomainDepositor, value: true },
    { functionName: "getRemoteDomainDepositor", value: deployment.helper.address },
    { functionName: "getRemoteDomainHookExecutor", value: deployment.helper.address },
    { functionName: "gatewayWallet", value: deployment.helper.address },
    { functionName: "gatewayMinter", value: deployment.helper.address },
    { functionName: "localTokenMessenger", value: deployment.helper.address },
    { functionName: "isMinter", value: false },
    { functionName: "minterAllowance", value: "999999" },
    { functionName: "allowance", value: "999999" },
    ...[deployment.helper.address, deployment.arc.xReserve.address, deployment.arc.gatewayWallet.address,
      deployment.arc.tokenMinter.address, deployment.miden.remoteDomainDepositor, `0x${"88".repeat(20)}`]
      .map(principal => ({ functionName: "isBlacklisted", principal, value: true })),
  ])("fresh policy $functionName blocks quote and cached signed source bytes", async policy => {
    const quote = await quoteManualHelper(input()); expect(quote.grossAmount).toBe("1000000");
    const signed = await signedFixture(), bytes = signed.transaction.serialize().toString("base64");
    await change({ policy });
    await expect(quoteManualHelper(input())).rejects.toThrow();
    for (const method of ["simulateTransaction", "sendTransaction"] as const) {
      expect((await sourceRequest(method, bytes)).status).toBe(503);
    }
    const actual = await state(); expect(actual.sends).toHaveLength(0); expect(actual.simulations).toHaveLength(0);
    expect(signed.transaction.serialize().toString("base64")).toBe(bytes);
  });
  it.each([deployment.arc.gatewayWallet.address, deployment.arc.gatewayMinter.address])("runtime mismatch for configured dependency %s blocks admission", async codeMismatch => {
    await change({ codeMismatch }); await expect(quoteManualHelper(input())).rejects.toThrow("code mismatch");
    expect((await state()).sends).toHaveLength(0);
  });
  it("actual finalized failure status and raw transaction produce the writer's consistent failed shape", async () => {
    const signed = await signedFixture();
    expect((await sourceRequest("sendTransaction", signed.transaction.serialize().toString("base64"))).status).toBe(200);
    await change({ sourceFailed: true });
    const observation = await readManualHelperTransfer(deployment.deploymentId, signed.signature);
    expect(observation.state).toBe("source_failed");
    const route = routesForEnvironment("testnet").find(value => value.transport === "cctp-helper")!;
    const activity = createActivity(route, "1", { sourceTxHash: signed.signature, solanaAddress: signed.authorization.sourceAccount, midenAccount: golden.miden.accountHex,
      cctpHelper: { schemaVersion: 1, execution: "manual", authorization: signed.authorization, attemptId: "canonical-source-failed", stage: "source_unknown",
        eventAccount: event.publicKey.toBase58(), scanStartSlot: "100", blockhash: signed.transaction.recentBlockhash!, lastValidBlockHeight: "200",
        signature: signed.signature, signedBytes: signed.transaction.serialize().toString("base64"), sourceFeeLamports: "5000", eventRentLamports: "1000000" } });
    vi.stubGlobal("fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => String(url).startsWith("/api/cctp-helper/manual/attestation")
      ? Response.json(observation) : nativeFetch(url, init));
    const patch = (await observeManualHelper(activity, new AbortController().signal)).patch;
    expect(helperActivitySchema.parse(patch.cctpHelper)).toMatchObject({ stage: "source_failed", signature: signed.signature, failedSlot: "106", signedBytes: undefined });
    expect((await state()).sends).toHaveLength(1);
  });
  it.each([
    { policy: { functionName: "domainWithdrawalsPaused", value: true } },
    { policy: { functionName: "gatewayMinter", value: deployment.helper.address } },
    { policy: { functionName: "paused", target: deployment.arc.gatewayMinter.address, value: true } },
    { policy: { functionName: "maxMessageBodySize", value: "0" } },
    { codeMismatch: deployment.arc.gatewayMinter.address },
  ])("historical incoming recovery ignores unrelated withdrawal/send policy %#", async mutation => {
    const signed = await signedFixture();
    expect((await sourceRequest("sendTransaction", signed.transaction.serialize().toString("base64"))).status).toBe(200);
    await change(mutation);
    expect((await readManualHelperTransfer(deployment.deploymentId, signed.signature)).state).toBe("ready");
    await expect(quoteManualHelper(input())).rejects.toThrow();
    expect((await state()).sends).toHaveLength(1);
  });
  it.each(["zero", "error", "malformed", "blacklisted"])("historical zero-fee recovery ignores unrelated %s fee-recipient policy", async failure => {
    const signed = await signedFixture();
    expect((await sourceRequest("sendTransaction", signed.transaction.serialize().toString("base64"))).status).toBe(200);
    await change({ executedFee: "0", ...(failure === "zero" ? { feeRecipient: `0x${"00".repeat(20)}` }
      : failure === "blacklisted" ? { policy: { functionName: "isBlacklisted", principal: `0x${"88".repeat(20)}`, value: true } }
      : { feeRecipientResult: failure }) });
    expect((await readManualHelperTransfer(deployment.deploymentId, signed.signature)).state).toBe("ready");
    expect((await state()).sends).toHaveLength(1);
  });
  it("historical Gateway allowance covers authenticated net while native USDC mint allowance still covers gross", async () => {
    const signed = await signedFixture();
    expect((await sourceRequest("sendTransaction", signed.transaction.serialize().toString("base64"))).status).toBe(200);
    await change({ executedFee: "10", policy: { functionName: "allowance", value: "999990" } });
    const observed = await readManualHelperTransfer(deployment.deploymentId, signed.signature);
    expect(observed.state).toBe("ready");
    if (observed.state === "ready") expect(observed.bundle.netAmount).toBe("999990");
    await expect(quoteManualHelper(input())).rejects.toThrow();
    await change({ policy: { functionName: "minterAllowance", value: "999990" } });
    expect(await readManualHelperTransfer(deployment.deploymentId, signed.signature)).toEqual({ state: "needs_attention", reason: "attestation_invalid" });
    expect((await state()).sends).toHaveLength(1);
  });
  it("historical finalized F=0 remains exportable for self recipient; F>0 fails full helper simulation", async () => {
    const signed = await signedFixture(), response = await sourceRequest("sendTransaction", signed.transaction.serialize().toString("base64"));
    expect(response.status).toBe(200);
    await change({ feeRecipient: deployment.helper.address, executedFee: "0" });
    const zero = await readManualHelperTransfer(deployment.deploymentId, signed.signature);
    expect(zero.state).toBe("ready"); if (zero.state === "ready") expect(zero.bundle.feeExecuted).toBe("0");
    await change({ executedFee: "1" });
    expect(await readManualHelperTransfer(deployment.deploymentId, signed.signature)).toEqual({ state: "needs_attention", reason: "attestation_invalid" });
    await change({ feeRecipient: `0x${"88".repeat(20)}` });
    expect((await readManualHelperTransfer(deployment.deploymentId, signed.signature)).state).toBe("ready");
    expect((await state()).sends).toHaveLength(1);
  });
});
