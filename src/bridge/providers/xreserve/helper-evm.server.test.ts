import { beforeEach, describe, expect, it, vi } from "vitest";
import { evmAuthorization, evmDeployment, evmMessage, evmRow, replaceMessageField, txHash, blockHash } from "./fixtures/evm/test-fixture";
import { quoteEvmHelper, observeEvmHelper } from "./helper-evm.server";
import { validateEvmBundle } from "./helper-evm-validation";
vi.mock("server-only", () => ({}));
const { destination, simulate, sourcePolicy, sourceRead } = vi.hoisted(() => ({ destination: vi.fn(), simulate: vi.fn(), sourcePolicy: vi.fn(), sourceRead: vi.fn() }));
vi.mock("./helper-preflight.server", async original => ({ ...await original<typeof import("./helper-preflight.server")>(), assertManualDestination: destination }));
vi.mock("./helper-evm-policy.server", () => ({ assertEvmSourcePolicy: sourcePolicy, evmStandardFee: async () => 100n }));
vi.mock("./helper-evm-source.server", () => ({ readEvmHelperSource: sourceRead }));
vi.mock("../../../config/cctp-evm-helper.server", async () => { const { evmDeployment } = await import("./fixtures/evm/test-fixture"); return { evmHelperServer: () => ({ deployment: evmDeployment, server }) }; });
const server = { deploymentId: "evm-sepolia-test", sourceRpc: "https://source.invalid", arcRpc: "https://arc.invalid", irisApi: "https://iris-api-sandbox.circle.com", simulationCaller: "0x8888888888888888888888888888888888888888" as const };
function fixture() {
  const auth = evmAuthorization(), message = evmMessage(auth), source = { sourceTransaction: txHash, blockHash, blockNumber: "101", logIndex: 2,
    sourceAccount: auth.sourceAccount, grossAmount: auth.grossAmount, maxCctpFee: auth.maxCctpFee, midenRecipient: auth.midenRecipient, message };
  const attested = replaceMessageField(replaceMessageField(replaceMessageField(message, 12, 32, 1), 144, 4, 2000), 312, 32, 10);
  const iris = { sourceTxHash: txHash, messages: [{ status: "complete", message: attested, attestation: `0x${"ab".repeat(65)}`, cctpVersion: 2 }] };
  return { auth, source, iris };
}
beforeEach(() => { vi.clearAllMocks(); simulate.mockResolvedValue({ result: true }); destination.mockResolvedValue({ simulateContract: simulate }); sourcePolicy.mockResolvedValue(0n);
  sourceRead.mockResolvedValue({ state: "source_finalized", source: fixture().source }); vi.stubGlobal("fetch", vi.fn(async () => Response.json(fixture().iris))); });
describe("actual EVM quote and authenticated manual handoff", () => {
  it("checks both mutable chains and retains exact gross/cap/minimum", async () => {
    const a = evmAuthorization(), q = await quoteEvmHelper({ deploymentId: a.deploymentId, sourceAccount: a.sourceAccount, grossAmount: a.grossAmount, midenRecipient: a.midenRecipient });
    expect(q.maxCctpFee).toBe("100"); expect(q.minimumNet).toBe("999900"); expect(destination).toHaveBeenCalled(); expect(sourcePolicy).toHaveBeenCalled();
    sourcePolicy.mockRejectedValue(new Error("source paused")); await expect(quoteEvmHelper(q)).rejects.toThrow();
  });
  it("authenticates the exact source through Arc transmitter and full atomic helper simulation", async () => {
    const f = fixture(), observed = await observeEvmHelper({ authorization: f.auth, hash: txHash });
    expect(observed.state).toBe("ready");
    if (observed.state !== "ready") throw new Error(JSON.stringify(observed));
    expect(observed.bundle.netAmount).toBe("999990"); expect(validateEvmBundle(observed.bundle, evmRow())).toEqual(observed.bundle);
    expect(simulate).toHaveBeenNthCalledWith(1, expect.objectContaining({ address: evmDeployment.arc.messageTransmitter.address, account: evmDeployment.helper.address, functionName: "receiveMessage" }));
    expect(simulate).toHaveBeenNthCalledWith(2, expect.objectContaining({ address: evmDeployment.helper.address, functionName: "receiveAndDeposit" }));
  });
  it.each(["wrong-envelope", "multiple", "fee", "finality", "nonce", "simulation"])("keeps %s unresolved without exporting", async mutation => {
    const f = fixture();
    if (mutation === "wrong-envelope") f.iris.sourceTxHash = `0x${"01".repeat(32)}`;
    if (mutation === "multiple") f.iris.messages.push(f.iris.messages[0]);
    if (mutation === "fee") f.iris.messages[0].message = replaceMessageField(f.iris.messages[0].message, 312, 32, 101);
    if (mutation === "finality") f.iris.messages[0].message = replaceMessageField(f.iris.messages[0].message, 144, 4, 1000);
    if (mutation === "nonce") f.iris.messages[0].message = replaceMessageField(f.iris.messages[0].message, 12, 32, 0);
    if (mutation === "simulation") simulate.mockRejectedValue(new Error("atomic call unavailable"));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(f.iris)));
    expect((await observeEvmHelper({ authorization: f.auth, hash: txHash })).state).toBe("needs_attention");
  });
});
