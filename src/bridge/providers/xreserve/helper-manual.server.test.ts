import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData } from "viem";
import { validateManualHelperAttestation, manualApi, manualRequestJson, limitManualRequest } from "./helper-manual.server";
import { validateManualSource } from "../../solana/source-transaction";
import { guardSolanaTransaction } from "../../solana/rpc";
import { authorization, deployment, event, signedFixture } from "./fixtures/manual/test-fixture";
import { validateBundleForActivity } from "./helper-manual";
import { helperAbi } from "./helper-abi";
import type { HelperActivity } from "./helper-types";

vi.mock("server-only", () => ({}));
const { simulate, destination } = vi.hoisted(() => ({ simulate: vi.fn(), destination: vi.fn() }));
vi.mock("./helper-preflight.server", async importOriginal => ({
  ...await importOriginal<typeof import("./helper-preflight.server")>(),
  assertManualDestination: destination,
}));
const server = { deploymentId: deployment.deploymentId, solanaRpc: "https://solana.example.invalid", arcRpc: "https://arc.example.invalid", irisApi: "https://iris-api-sandbox.circle.com",
  simulationCaller: "0x8888888888888888888888888888888888888888" as const };
beforeEach(() => { vi.clearAllMocks(); destination.mockResolvedValue({ simulateContract: simulate }); simulate.mockResolvedValue({ result: true }); });
function field(message: string, start: number, length: number, value: string | number) {
  return `${message.slice(0, 2 + start * 2)}${BigInt(value).toString(16).padStart(length * 2, "0")}${message.slice(2 + (start + length) * 2)}` as `0x${string}`;
}
async function fixture() {
  const signed = await signedFixture();
  const source = await validateManualSource(guardSolanaTransaction(signed.raw, signed.signature), deployment);
  let message = field(source.message, 12, 32, 1);
  message = field(message, 144, 4, 2000); message = field(message, 312, 32, 10);
  const row = { status: "complete", message, attestation: `0x${"ab".repeat(65)}`, cctpVersion: 2 };
  const helper: HelperActivity = { schemaVersion: 1, execution: "manual", authorization: authorization(), attemptId: "test-attempt", stage: "source_unknown",
    eventAccount: event.publicKey.toBase58(), scanStartSlot: "100", blockhash: signed.transaction.recentBlockhash!, lastValidBlockHeight: "200",
    signature: signed.signature, signedBytes: signed.transaction.serialize().toString("base64"), sourceFeeLamports: "5000", eventRentLamports: "1000000" };
  return { source, row, iris: { sourceTxHash: signed.signature, messages: [row] }, helper };
}

describe("manual attestation admission and public export", () => {
  it("requires actual transmitter authentication with helper caller and a separate full helper simulation", async () => {
    const { source, iris, helper } = await fixture();
    const bundle = await validateManualHelperAttestation(source, iris, deployment, server);
    expect(bundle?.feeExecuted).toBe("10"); expect(bundle?.netAmount).toBe("999990");
    expect(simulate).toHaveBeenNthCalledWith(1, expect.objectContaining({ address: deployment.arc.messageTransmitter.address, functionName: "receiveMessage", account: deployment.helper.address }));
    expect(simulate).toHaveBeenNthCalledWith(2, expect.objectContaining({ address: deployment.helper.address, functionName: "receiveAndDeposit", account: server.simulationCaller }));
    expect(validateBundleForActivity(bundle!, helper)).toEqual(bundle);
    expect(JSON.stringify(bundle)).not.toContain(helper.signedBytes);
    expect(JSON.stringify(bundle)).not.toContain(server.solanaRpc);
  });
  it.each(["envelope", "multiple", "length", "sender", "token", "helper", "recipient", "amount", "cap", "requested", "executed", "expiry", "fee", "empty-attestation"])("blocks %s attestation mutation before export", async mutation => {
    const { source, iris, row } = await fixture();
    if (mutation === "envelope") iris.sourceTxHash = "1".repeat(64);
    if (mutation === "multiple") iris.messages.push({ ...row });
    const fields: Record<string, [number, number, number]> = { sender: [248, 32, 1], token: [152, 32, 1], helper: [184, 32, 1], recipient: [408, 32, 1],
      amount: [216, 32, 2], cap: [280, 32, 3], requested: [140, 4, 500], executed: [144, 4, 500], expiry: [344, 32, 1], fee: [312, 32, 101] };
    if (fields[mutation]) row.message = field(row.message, ...fields[mutation]);
    if (mutation === "length") row.message = row.message.slice(0, -2) as `0x${string}`;
    if (mutation === "empty-attestation") row.attestation = "0x";
    await expect(validateManualHelperAttestation(source, iris, deployment, server)).rejects.toThrow();
    expect(simulate).not.toHaveBeenCalled();
  });
  it.each([1, 2])("does not treat nonempty signatures as authentic when simulation %s fails", async failure => {
    const { source, iris } = await fixture();
    if (failure === 2) simulate.mockResolvedValueOnce({ result: true });
    simulate.mockRejectedValueOnce(new Error("Invalid attestation or helper revert"));
    await expect(validateManualHelperAttestation(source, iris, deployment, server)).rejects.toThrow();
  });
  it("browser checks returned source bytes even when copied metadata still matches", async () => {
    const { source, iris, helper } = await fixture();
    const bundle = (await validateManualHelperAttestation(source, iris, deployment, server))!;
    bundle.source.message = field(bundle.source.message, 248, 32, 1);
    bundle.message = field(bundle.message, 248, 32, 1);
    bundle.call.data = encodeFunctionData({ abi: helperAbi, functionName: "receiveAndDeposit", args: [bundle.message, bundle.attestation] });
    expect(() => validateBundleForActivity(bundle, helper)).toThrow("source bytes");
  });
  it("browser rejects an inconsistent top-level fee cap", async () => {
    const { source, iris, helper } = await fixture();
    const bundle = (await validateManualHelperAttestation(source, iris, deployment, server))!;
    expect(() => validateBundleForActivity({ ...bundle, maxCctpFee: "101" }, helper)).toThrow();
  });
  it("keeps incomplete attestations pending", async () => {
    const { source, iris } = await fixture(); iris.messages[0].status = "pending_confirmations";
    await expect(validateManualHelperAttestation(source, iris, deployment, server)).resolves.toBeNull();
    expect(simulate).not.toHaveBeenCalled();
  });
});

describe("bounded manual HTTP behavior", () => {
  it("returns sanitized malformed-body400 and actual deployment throttle429", async () => {
    const bad = await manualApi(() => manualRequestJson(new Request("http://localhost", { method: "POST", body: "{" })));
    expect(bad.status).toBe(400); expect(await bad.json()).toEqual({ reason: "invalid_request" });
    for (let index = 0; index < 180; index++) limitManualRequest("unit-only-limit");
    const limited = await manualApi(async () => limitManualRequest("unit-only-limit"));
    expect(limited.status).toBe(429);
    const unavailable = await manualApi(async () => { throw new Error("https://secret-rpc.invalid/token"); });
    expect(unavailable.status).toBe(503); expect(await unavailable.text()).not.toContain("secret");
  });
});
