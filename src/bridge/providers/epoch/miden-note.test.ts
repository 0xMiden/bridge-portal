import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteType, TransactionRequest, type Note } from "@miden-sdk/miden-sdk";
import { currentBridgeConfig, type BridgeConfig } from "../../../config/bridge-config";
import { getCurrentMidenBlock } from "../../miden-rpc";
import { createBridgeP2IDENoteCallback } from "./miden-note";

// Real browser note construction and wallet serialization; only remote block and wallet responses are supplied.
vi.mock("@miden-sdk/miden-sdk", async () => (await import("../../../../test/miden-sdk")).browserMidenSdk());
vi.mock("@miden-sdk/miden-wallet-adapter-base", () => import("@miden-sdk/miden-wallet-adapter-base/dist/transaction.js"));
vi.mock("../../miden-rpc", () => ({ getCurrentMidenBlock: vi.fn(async () => 12_000) }));

const SENDER = "0x387149ae66116cf114eebd60bb7381";
const ALLOCATOR = "0x787149ae66116cf114eebd60bb7381";
const FAUCET = "0x5b043dcb48d5721106f7a1ceb2b804";
const BINDING = [1n, 2n, 3n, 4n];
function setup(senderAddress = SENDER, recovery?: BridgeConfig) {
  const requests: TransactionRequest[] = [];
  const requestTransaction = vi.fn(async transaction => {
    requests.push(TransactionRequest.deserialize(Buffer.from(transaction.payload.transactionRequest, "base64")));
    return "wallet-request-id";
  });
  const onNoteSubmitted = vi.fn();
  const onNoteCreated = vi.fn();
  const waitForTransaction = vi.fn(async id => {
    const note = requests.at(-1)!.expectedOutputOwnNotes()[0];
    expect(onNoteSubmitted).toHaveBeenCalledWith({ requestId: id, noteId: note.id().toString() });
    return { txHash: "0xtx", outputNotes: [
      { id: () => ({ toString: () => `0x${"00".repeat(32)}` }) } as Note, note,
    ] };
  });
  const callback = createBridgeP2IDENoteCallback({ senderAddress, requestTransaction, waitForTransaction, onNoteSubmitted, onNoteCreated }, recovery);
  return { callback, requestTransaction, waitForTransaction, onNoteCreated, requests };
}

describe("Epoch collateral wallet request", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it("serializes the sender, allocator, faucet, exact amount, binding and reclaim height", async () => {
    const { callback, requestTransaction, onNoteCreated, requests } = setup();
    const amount = BigInt(Number.MAX_SAFE_INTEGER) + 2n;
    const result = await callback(FAUCET, amount.toString(), ALLOCATOR, 3500, BINDING);
    expect(result.success).toBe(true);
    expect(requestTransaction).toHaveBeenCalledOnce();
    expect(requests[0].expectedOutputOwnNotes()).toHaveLength(1);
    const note = requests[0].expectedOutputOwnNotes()[0];
    expect(note.metadata().sender().toString()).toBe(SENDER);
    expect(note.metadata().noteType()).toBe(NoteType.Public);
    const assets = note.assets().fungibleAssets();
    expect(assets).toHaveLength(1);
    expect(assets[0].faucetId().toString()).toBe(FAUCET);
    expect(assets[0].amount()).toBe(amount);
    // P2IDE storage: sender and allocator suffix/prefix, reclaim and timelock heights.
    expect(note.recipient().storage().items().map(felt => felt.asInt())).toEqual([
      0x14eebd60bb738100n, 0x387149ae66116cf1n,
      0x14eebd60bb738100n, 0x787149ae66116cf1n, 15_500n, 0n,
    ]);
    expect(note.attachments()).toHaveLength(1);
    expect(Array.from(note.attachments()[0].toWords()[0].toU64s())).toEqual(BINDING);
    // The confirmed collateral ID must match the serialized note, even after a fee note.
    expect(result).toEqual({ success: true, noteId: note.id().toString() });
    expect(onNoteCreated).toHaveBeenCalledWith({ noteId: note.id().toString(), txHash: "0xtx" });
  });

  it.each([
    { name: "mainnet", senderAddress: "mm1aqu8zjdwvcgkeug5a67kpwmnsyv2qgp7_qr7qqq9wr6w", recovery: currentBridgeConfig("mainnet"), allocatorAddress: "mm1apu8zjdwvcgkeug5a67kpwmnsynr09mq_qr7qqq9wr6w" },
    { name: "testnet", senderAddress: "mtst1aqu8zjdwvcgkeug5a67kpwmnsymvmkg0_qr7qqq9wr6w", recovery: currentBridgeConfig("testnet"), allocatorAddress: "mtst1apu8zjdwvcgkeug5a67kpwmnsyy95mj3_qr7qqq9wr6w" },
    { name: "legacy hex sender", senderAddress: SENDER, recovery: undefined, allocatorAddress: "mtst1apu8zjdwvcgkeug5a67kpwmnsyy95mj3_qr7qqq9wr6w" },
  ])("preserves connected sender and route-network allocator in the $name wallet envelope", async ({ senderAddress, recovery, allocatorAddress }) => {
    const { callback, requestTransaction } = setup(senderAddress, recovery);
    expect((await callback(FAUCET, "1000", ALLOCATOR, 2000, BINDING)).success).toBe(true);
    expect(requestTransaction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: "custom", payload: expect.objectContaining({ address: senderAddress, recipientAddress: allocatorAddress }),
    }));
  });

  it("rejects invalid amounts, binding attachments and reclaim windows before requesting a signature", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { callback, requestTransaction } = setup();
    for (const amount of ["0", "-1", "not-a-number", (1n << 64n).toString()])
      expect(await callback(FAUCET, amount, ALLOCATOR, 2000, BINDING)).toEqual({ success: false });
    for (const attachment of [[], [-1n], [18_446_744_069_414_584_321n]])
      expect(await callback(FAUCET, "1000", ALLOCATOR, 2000, attachment)).toEqual({ success: false });
    for (const recall of [0, -1, 1.5, 0xffff_ffff])
      expect(await callback(FAUCET, "1000", ALLOCATOR, recall, BINDING)).toEqual({ success: false });
    vi.mocked(getCurrentMidenBlock).mockResolvedValueOnce(-1);
    expect(await callback(FAUCET, "1000", ALLOCATOR, 2000, BINDING)).toEqual({ success: false });
    expect(requestTransaction).not.toHaveBeenCalled();
  });

  it("carries a fresh fee-conversion salt through wallet serialization", async () => {
    const { callback, requests } = setup();
    await callback(FAUCET, "1000", ALLOCATOR, 2000, BINDING);
    await callback(FAUCET, "1000", ALLOCATOR, 2000, BINDING);
    const salts = requests.map(request => request.feeConversionSalt()?.toHex());
    expect(salts).toHaveLength(2);
    expect(salts[0]).toMatch(/^0x[\da-f]{64}$/);
    expect(salts[1]).toMatch(/^0x[\da-f]{64}$/);
    expect(salts[0]).not.toBe(salts[1]);
  });

  it.each(["rejected", "confirmation failed", "missing collateral"])("does not report a committed note when %s", async failure => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { callback, requestTransaction, waitForTransaction, onNoteCreated } = setup();
    if (failure === "rejected") requestTransaction.mockRejectedValue(new Error("User rejected the request"));
    else if (failure === "confirmation failed") waitForTransaction.mockRejectedValue(new Error("Confirmation failed"));
    else waitForTransaction.mockResolvedValue({ txHash: "0xtx", outputNotes: [] });
    expect(await callback(FAUCET, "1000", ALLOCATOR, 2000, BINDING)).toEqual({ success: false });
    if (failure === "rejected") expect(waitForTransaction).not.toHaveBeenCalled();
    expect(onNoteCreated).not.toHaveBeenCalled();
  });
});
