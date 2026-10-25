import { expect, it, vi } from "vitest";
import { withdrawUsdcx } from "./withdrawal-execute";

const policy = vi.hoisted(() => ({ minimum: 3_000_000n }));
vi.mock("@miden-sdk/miden-wallet-adapter-base", () => import("@miden-sdk/miden-wallet-adapter-base/dist/transaction.js"));
vi.mock("@miden-sdk/miden-sdk", async () => {
  const sdk = await (await import("../../../../test/miden-sdk")).browserMidenSdk();
  return { ...sdk, RpcClient: class {
    async getAccountDetails() {
      throw new Error("Full nonce registry is too large; request only the burn policy");
    }
    async getAccountProof() {
      return {
        getStorageSlotValue: () => ({ toU64s: () => [policy.minimum], free() {} }),
        getStorageMapEntries: () => [{
          key: () => sdk.NoteScript.burn().root(),
          value: () => ({ toU64s: () => [1n], free() {} }), free() {},
        }],
        free() {},
      };
    }
    free() {}
  } };
});

it("checks the burn minimum even when the faucet nonce map cannot be fetched in full", async () => {
  const requestTransaction = vi.fn();
  await expect(withdrawUsdcx({
    amount: "2", network: "arc-testnet", destination: "0x1122334455667788990011223344556677889900",
    sender: "0x4e6fb40fd2f6a55140df2c42dfb5b7", requestTransaction,
    waitForTransaction: vi.fn(), onSubmitted: vi.fn(),
  })).rejects.toThrow("The faucet requires at least 3 USDCx per withdrawal.");
  expect(requestTransaction).not.toHaveBeenCalled();
});

it.each([
  { network: "arc-testnet", domain: 26n },
  { network: "base-sepolia", domain: 6n },
  { network: "arbitrum-sepolia", domain: 3n },
  { network: "sepolia", domain: 0n },
] as const)("serializes the exact USDCx burn and recipient for $network", async ({ network, domain }) => {
  policy.minimum = 1_000_000n;
  const { TransactionRequest, NetworkAccountTarget, NoteScript } = await import("@miden-sdk/miden-sdk");
  const sender = "0x4e6fb40fd2f6a55140df2c42dfb5b7";
  const submitted = vi.fn();
  const requestTransaction = vi.fn(async transaction => {
    expect(transaction).toMatchObject({ type: "custom", payload: { address: sender, recipientAddress: sender } });
    const request = TransactionRequest.deserialize(Buffer.from(transaction.payload.transactionRequest, "base64"));
    const notes = request.expectedOutputOwnNotes();
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note.metadata().sender().toString()).toBe(sender);
    expect(note.script().root().toHex()).toBe(NoteScript.burn().root().toHex());
    const assets = note.assets().fungibleAssets();
    expect(assets).toHaveLength(1);
    expect(assets[0].faucetId().toString()).toBe("0x4cbdcaffe75f0a317482224dae6436");
    expect(assets[0].amount()).toBe(2_000_001n);
    const attachments = note.attachments();
    expect(NetworkAccountTarget.fromAttachment(attachments[0]).targetId().toString())
      .toBe("0x4cbdcaffe75f0a317482224dae6436");
    // Scheme 5 carries the Circle domain and padded, little-endian EVM recipient.
    expect(attachments[1].toWords().flatMap(word => Array.from(word.toU64s()))).toEqual([
      domain, 0n, 0n, 0n, 0n, 0n, 0n,
      0x44332211n, 0x88776655n, 0x22110099n, 0x66554433n, 0x00998877n,
    ]);
    expect(request.feeConversionSalt()).toBeDefined();
    return "burn-request-id";
  });
  const waitForTransaction = vi.fn(async id => {
    expect(submitted).toHaveBeenCalledWith(expect.stringMatching(/^0x[\da-f]{64}$/), id);
    return { txHash: `0x${"cd".repeat(32)}`, outputNotes: [] };
  });
  const result = await withdrawUsdcx({
    amount: "2.000001", network, destination: "0x1122334455667788990011223344556677889900",
    sender, requestTransaction, waitForTransaction, onSubmitted: submitted,
  });
  expect(requestTransaction).toHaveBeenCalledOnce();
  expect(waitForTransaction).toHaveBeenCalledExactlyOnceWith("burn-request-id");
  expect(result.txHash).toBe(`0x${"cd".repeat(32)}`);
});
