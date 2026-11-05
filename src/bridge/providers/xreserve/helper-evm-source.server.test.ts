import { beforeEach, describe, expect, it, vi } from "vitest";
import { readEvmHelperSource, } from "./helper-evm-source.server";
import { assertEvmSourceMessage } from "./helper-evm-validation";
import { sourceFixture, replaceMessageField, txHash, blockHash } from "./fixtures/evm/test-fixture";
vi.mock("server-only", () => ({}));
const { rpc } = vi.hoisted(() => ({ rpc: { getChainId: vi.fn(), getTransactionReceipt: vi.fn(), getTransaction: vi.fn(), getBlock: vi.fn() } }));
vi.mock("./helper-evm-policy.server", () => ({ evmSourceClient: () => rpc }));
const server = { deploymentId: "evm-sepolia-test", sourceRpc: "https://source.invalid", arcRpc: "https://arc.invalid", irisApi: "https://iris-api-sandbox.circle.com", simulationCaller: "0x8888888888888888888888888888888888888888" as const };
beforeEach(() => { vi.clearAllMocks(); const f = sourceFixture(); rpc.getChainId.mockResolvedValue(11155111); rpc.getTransactionReceipt.mockResolvedValue(f.receipt);
  rpc.getTransaction.mockResolvedValue(f.tx); rpc.getBlock.mockResolvedValue({ number: 101n, hash: blockHash }); });
describe("native EVM source evidence", () => {
  it("binds actual calldata and one canonical finalized transmitter log", async () => {
    const f = sourceFixture(), result = await readEvmHelperSource(f.auth, txHash, server);
    expect(result.state).toBe("source_finalized");
    if (result.state === "source_finalized") expect(result.source).toMatchObject({ sourceTransaction: txHash, blockHash, blockNumber: "101", logIndex: 2, grossAmount: "1000000" });
    expect(rpc.getBlock).toHaveBeenCalledWith({ blockTag: "finalized" });
  });
  it.each(["sender", "target", "calldata", "value", "receipt-hash", "block", "multiple", "wrong-log-address", "chain"])("rejects %s identity mutation", async mutation => {
    const f = sourceFixture();
    if (mutation === "sender") f.tx.from = "0x2222222222222222222222222222222222222222" as typeof f.tx.from;
    if (mutation === "target") f.tx.to = "0x2222222222222222222222222222222222222222";
    if (mutation === "calldata") f.tx.input = "0x1234";
    if (mutation === "value") f.tx.value = 1n;
    if (mutation === "receipt-hash") f.receipt.transactionHash = `0x${"de".repeat(32)}`;
    if (mutation === "block") rpc.getBlock.mockResolvedValue({ number: 101n, hash: `0x${"de".repeat(32)}` });
    if (mutation === "multiple") f.receipt.logs.push(f.receipt.logs[0]);
    if (mutation === "wrong-log-address") f.receipt.logs[0].address = "0x2222222222222222222222222222222222222222";
    if (mutation === "chain") rpc.getChainId.mockResolvedValue(1);
    rpc.getTransaction.mockResolvedValue(f.tx); rpc.getTransactionReceipt.mockResolvedValue(f.receipt);
    await expect(readEvmHelperSource(f.auth, txHash, server)).rejects.toThrow();
  });
  it.each([4, 8, 44, 76, 108, 140, 148, 152, 184, 216, 248, 280, 376, 408])("rejects immutable message field at byte %s", offset => {
    const f = sourceFixture(), width = [4, 8, 140, 148, 376].includes(offset) ? 4 : 32;
    expect(() => assertEvmSourceMessage(replaceMessageField(f.message, offset, width, 123), f.auth)).toThrow();
  });
  it("cannot turn a nonfinal receipt or unsupported finalized tag into source failure", async () => {
    const f = sourceFixture(); f.receipt.status = "reverted"; rpc.getTransactionReceipt.mockResolvedValue(f.receipt);
    rpc.getBlock.mockResolvedValue({ number: 100n, hash: blockHash });
    await expect(readEvmHelperSource(f.auth, txHash, server)).resolves.toEqual({ state: "pending" });
    rpc.getBlock.mockRejectedValue(new Error("unsupported block tag"));
    await expect(readEvmHelperSource(f.auth, txHash, server)).rejects.toThrow("unsupported");
  });
  it("returns failed only for the exact reverted call in a canonical finalized block", async () => {
    const f = sourceFixture(); f.receipt.status = "reverted"; rpc.getTransactionReceipt.mockResolvedValue(f.receipt);
    await expect(readEvmHelperSource(f.auth, txHash, server)).resolves.toEqual({ state: "source_failed", hash: txHash, blockNumber: "101", blockHash });
  });
});
