import { afterEach, describe, expect, it, vi } from "vitest";
import { guardSolanaTransaction, createSolanaConnection } from "./rpc";
import { readFinalizedManualSource, validateManualSource } from "./source-transaction";
import { deployment, signedFixture } from "../providers/xreserve/fixtures/manual/test-fixture";
import v0 from "../providers/xreserve/fixtures/manual/captured-v0.json";
import v1 from "../providers/xreserve/fixtures/manual/captured-v1.json";
import { manualRpcRequestSchema } from "./rpc-request";

afterEach(() => vi.unstubAllGlobals());
describe("finalized source occurrence authentication", () => {
  it("binds actual parent accounts/message and full inner ordinal", async () => {
    const fixture = await signedFixture();
    const source = await validateManualSource(guardSolanaTransaction(fixture.raw, fixture.signature), deployment);
    expect(source.sourceEventIds).toEqual([`solana:${fixture.signature}:0:2`]);
    expect(source.message).toBe(fixture.sourceMessage);
    const extra = structuredClone(fixture.raw);
    extra.meta.innerInstructions[0].instructions.unshift(extra.meta.innerInstructions[0].instructions[0]);
    expect((await validateManualSource(guardSolanaTransaction(extra, fixture.signature), deployment)).sourceEventIds).toEqual([`solana:${fixture.signature}:0:3`]);
  });
  it.each(["sender", "program", "duplicate", "missing-cpi", "failed"])("rejects %s source evidence", async mutation => {
    const fixture = await signedFixture(), raw = structuredClone(fixture.raw);
    if (mutation === "sender") raw.transaction.message.accountKeys[0] = deployment.source.mint;
    if (mutation === "program") raw.transaction.message.instructions[0].programIdIndex = 0;
    if (mutation === "duplicate") raw.meta.innerInstructions[0].instructions.push(raw.meta.innerInstructions[0].instructions[2]);
    if (mutation === "missing-cpi") raw.meta.innerInstructions[0].instructions.splice(1, 1);
    if (mutation === "failed") raw.meta.err = { InstructionError: [0, "Custom"] };
    await expect(validateManualSource(guardSolanaTransaction(raw, fixture.signature), deployment)).rejects.toThrow();
  });
  it.each(["status-failed", "raw-failed"])("keeps %s contradiction unresolved", async mutation => {
    const fixture = await signedFixture();
    const failed = { InstructionError: [0, { Custom: 1 }] };
    fixture.raw.meta.err = mutation === "raw-failed" ? failed : null;
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const result = request.method === "getGenesisHash" ? deployment.source.genesisHash : request.method === "getSignatureStatuses" ?
        { context: { slot: 105 }, value: [{ slot: 105, confirmations: null, confirmationStatus: "finalized", err: mutation === "status-failed" ? failed : null }] } :
        request.method === "getTransaction" ? fixture.raw : 105;
      return Response.json({ jsonrpc: "2.0", id: request.id, result });
    }));
    await expect(readFinalizedManualSource(deployment, "https://example.invalid", fixture.signature)).rejects.toThrow("Contradictory");
  });
  it("retains pending on a null history result and never invents no-burn evidence", async () => {
    const fixture = await signedFixture();
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "getGenesisHash" ? deployment.source.genesisHash : { context: { slot: 105 }, value: [null] } });
    }));
    await expect(readFinalizedManualSource(deployment, "https://example.invalid", fixture.signature)).resolves.toEqual({ state: "pending" });
  });
});

describe("guarded direct web3.js 1.99 history reads", () => {
  it.each([v0, v1])("reads genuine captured version $response.result.version through the public fetch guard", async capture => {
    const signature = capture.request.params[0];
    if (typeof signature !== "string") throw new Error("Missing captured signature.");
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)); expect(request.params[1].maxSupportedTransactionVersion).toBe(1);
      return Response.json({ ...capture.response, id: request.id });
    }));
    const response = await createSolanaConnection(deployment, "https://example.invalid").getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 1 });
    expect(response?.version).toBe(capture.response.result.version);
  });
  it.each(["empty-alt", "missing-config", "negative-u32", "overflow-u32", "unsafe-fee", "future", "wrong-signature"])("rejects raw %s before normalization", mutation => {
    const raw: Record<string, unknown> = structuredClone(v1.response.result);
    const message = structuredClone(v1.response.result.transaction.message);
    if (mutation === "empty-alt") Object.assign(message, { addressTableLookups: [] });
    if (mutation === "missing-config") Object.assign(message, { transactionConfig: null });
    if (mutation === "negative-u32") message.transactionConfig.computeUnitLimit = -1;
    if (mutation === "overflow-u32") Object.assign(message.transactionConfig, { heapSize: 0x1_0000_0000 });
    if (mutation === "unsafe-fee") message.transactionConfig.priorityFee = Number.MAX_SAFE_INTEGER + 1;
    if (mutation === "future") raw.version = 2;
    raw.transaction = { ...v1.response.result.transaction, message };
    expect(() => guardSolanaTransaction(raw, mutation === "wrong-signature" ? "1".repeat(64) : String(v1.request.params[0]))).toThrow();
  });
  it("rejects arbitrary proxy methods, injected URLs, unbounded keys and unsafe send policy", () => {
    const base = { jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: [] };
    expect(manualRpcRequestSchema.safeParse(base).success).toBe(true);
    for (const value of [{ ...base, url: "https://attacker.invalid" }, { ...base, method: "requestAirdrop" },
      { ...base, method: "getMultipleAccounts", params: [Array(21).fill(deployment.source.mint), { encoding: "base64", commitment: "confirmed" }] },
      { ...base, method: "sendTransaction", params: ["YWJj", { encoding: "base64", skipPreflight: true, preflightCommitment: "confirmed", maxRetries: 0 }] }])
      expect(manualRpcRequestSchema.safeParse(value).success).toBe(false);
  });
});
