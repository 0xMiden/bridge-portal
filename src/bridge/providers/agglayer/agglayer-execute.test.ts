import { expect, it, vi } from "vitest";
import { NetworkAccountTarget, TransactionRequest } from "@miden-sdk/miden-sdk";
import { runAgglayerSend } from "./agglayer-execute";

// Use the same browser WASM/serialization as the app; only the wallet is simulated.
vi.mock("@miden-sdk/miden-sdk", async () => (await import("../../../../test/miden-sdk")).browserMidenSdk());
vi.mock("@miden-sdk/miden-wallet-adapter-base", () => import("@miden-sdk/miden-wallet-adapter-base/dist/transaction.js"));

it("submits a serialized B2AGG note binding sender, faucet, exact amount and EVM destination", async () => {
  const sender = "0x387149ae66116cf114eebd60bb7381";
  const submitted = vi.fn();
  const requestTransaction = vi.fn(async transaction => {
    expect(transaction).toMatchObject({ type: "custom", payload: { address: sender, recipientAddress: sender } });
    const request = TransactionRequest.deserialize(Buffer.from(transaction.payload.transactionRequest, "base64"));
    const notes = request.expectedOutputOwnNotes();
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note.metadata().sender().toString()).toBe(sender);
    const assets = note.assets().fungibleAssets();
    expect(assets).toHaveLength(1);
    expect(assets[0].faucetId().toString()).toBe("0x7c6d1dc7fb7045913d524bbef017f5");
    expect(assets[0].amount()).toBe(1_000_001n);
    // Protocol storage: destination network followed by five little-endian u32 address limbs.
    expect(note.recipient().storage().items().map(felt => felt.asInt())).toEqual([
      0n, 0x44332211n, 0x88776655n, 0x22110099n, 0x66554433n, 0x00998877n,
    ]);
    expect(NetworkAccountTarget.fromAttachment(note.attachments()[0]).targetId().toString())
      .toBe("0x187cabbc404359d16be94954ca9879");
    expect(request.feeConversionSalt()).toBeDefined();
    return "wallet-request-id";
  });
  const waitForTransaction = vi.fn(async id => {
    expect(submitted).toHaveBeenCalledWith({ requestId: id, noteId: expect.stringMatching(/^0x[\da-f]{64}$/) });
    return { txHash: `0x${"ab".repeat(32)}`, outputNotes: [] };
  });
  const result = await runAgglayerSend({
    amount: 1_000_001n, faucetId: "0x7c6d1dc7fb7045913d524bbef017f5",
    destinationAddress: "0x1122334455667788990011223344556677889900", senderAddress: sender,
    requestTransaction, waitForTransaction, onSubmitted: submitted,
  });
  expect(requestTransaction).toHaveBeenCalledOnce();
  expect(waitForTransaction).toHaveBeenCalledExactlyOnceWith("wallet-request-id");
  expect(result).toEqual({ txId: "wallet-request-id", txHash: `0x${"ab".repeat(32)}` });
});
