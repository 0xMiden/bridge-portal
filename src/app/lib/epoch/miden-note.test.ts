import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@miden-sdk/miden-sdk", () => ({
  AccountId: {
    fromHex: (value: string) => ({ toBech32: () => value }),
  },
  AccountInterface: { BasicWallet: "basic-wallet" },
  NetworkId: { testnet: () => "testnet" },
  FungibleAsset: class { constructor(public faucet: unknown, public amount: bigint) {} },
  NoteAssets: class { constructor(public assets: unknown[]) {} },
  NoteArray: class { constructor(public notes: unknown[]) {} },
  NoteAttachment: class { constructor(public felts: BigUint64Array) {} },
  NoteType: { Public: "public" },
  Note: { createP2IDENote: vi.fn(() => ({ id: () => ({ toString: () => "0xnote" }) })) },
  TransactionRequestBuilder: class {
    salt: unknown;
    withFeeConversionSalt(salt: unknown) { this.salt = salt; return this; }
    withOwnOutputNotes = vi.fn().mockReturnThis();
    build = vi.fn(() => ({ request: true, salt: this.salt }));
  },
}));
vi.mock("@miden-sdk/miden-wallet-adapter-base", () => ({
  Transaction: { createCustomTransaction: vi.fn(() => ({ type: "custom" })) },
}));
vi.mock("@miden-sdk/miden-wallet-adapter-react", () => ({ useMidenFiWallet: vi.fn() }));
vi.mock("./bridge", () => ({ normalizeMidenIdToHex: (value: string) => value }));
vi.mock("./chain", () => ({ getCurrentMidenBlock: vi.fn(async () => 12_000) }));
vi.mock("../miden-transaction", () => ({ createFeeConversionSalt: vi.fn() }));

import { Note } from "@miden-sdk/miden-sdk";
import { Transaction } from "@miden-sdk/miden-wallet-adapter-base";
import { createFeeConversionSalt } from "../miden-transaction";
import { getCurrentMidenBlock } from "./chain";
import { createBridgeP2IDENoteCallback, type MidenNoteDeps } from "./miden-note";

const TEST_ACCOUNT_ID = "0x387149ae66116cf114eebd60bb7381";
const BINDING = [1n, 2n, 3n, 4n];
function setup() {
  const requestTransaction = vi.fn().mockResolvedValue("wallet-request-id");
  const waitForTransaction = vi.fn().mockResolvedValue({
    txHash: "0xtx", outputNotes: [
      { id: () => ({ toString: () => "0xfee" }) },
      { id: () => ({ toString: () => "0xnote" }) },
    ],
  });
  const onNoteCreated = vi.fn();
  const callback = createBridgeP2IDENoteCallback({
    senderAddress: TEST_ACCOUNT_ID,
    requestTransaction: requestTransaction as MidenNoteDeps["requestTransaction"],
    waitForTransaction: waitForTransaction as MidenNoteDeps["waitForTransaction"],
    onNoteCreated,
  });
  return { callback, requestTransaction, waitForTransaction, onNoteCreated };
}

describe("createBridgeP2IDENoteCallback", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it("preserves the SDK attachment, dynamic reclaim window and bigint amount", async () => {
    const { callback, requestTransaction, onNoteCreated } = setup();
    const amount = BigInt(Number.MAX_SAFE_INTEGER) + 2n;
    const result = await callback(TEST_ACCOUNT_ID, amount.toString(), TEST_ACCOUNT_ID, 3500, BINDING);

    expect(result).toEqual({ success: true, noteId: "0xnote" });
    expect(Note.createP2IDENote).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ assets: [expect.objectContaining({ amount })] }),
      15_500, null, "public", expect.objectContaining({ felts: BigUint64Array.from(BINDING) }),
    );
    expect(requestTransaction).toHaveBeenCalledWith({ type: "custom" });
    expect(onNoteCreated).toHaveBeenCalledWith({ noteId: "0xnote", txHash: "0xtx" });
  });

  it("rejects invalid amounts before wallet submission", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { callback, requestTransaction } = setup();
    for (const amount of ["0", "-1", "not-a-number", (1n << 64n).toString()]) {
      expect(await callback(TEST_ACCOUNT_ID, amount, TEST_ACCOUNT_ID, 2000, BINDING))
        .toEqual({ success: false });
    }
    expect(requestTransaction).not.toHaveBeenCalled();
  });

  it("declares a fresh fee-conversion salt for every wallet request", async () => {
    const { callback } = setup();
    const first = { salt: 1 } as unknown as ReturnType<typeof createFeeConversionSalt>;
    const second = { salt: 2 } as unknown as ReturnType<typeof createFeeConversionSalt>;
    vi.mocked(createFeeConversionSalt).mockReturnValueOnce(first).mockReturnValueOnce(second);
    await callback(TEST_ACCOUNT_ID, "1000", TEST_ACCOUNT_ID, 2000, BINDING);
    await callback(TEST_ACCOUNT_ID, "1000", TEST_ACCOUNT_ID, 2000, BINDING);
    const calls = vi.mocked(Transaction.createCustomTransaction).mock.calls;
    expect(calls[0][2]).toEqual({ request: true, salt: first });
    expect(calls[1][2]).toEqual({ request: true, salt: second });
    expect(createFeeConversionSalt).toHaveBeenCalledTimes(2);
  });

  it("rejects missing or invalid binding attachments and reclaim windows before submission", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { callback, requestTransaction } = setup();
    for (const attachment of [[], [-1n], [18_446_744_069_414_584_321n]]) {
      expect(await callback(TEST_ACCOUNT_ID, "1000", TEST_ACCOUNT_ID, 2000, attachment))
        .toEqual({ success: false });
    }
    for (const recall of [0, -1, 1.5, 0xffff_ffff]) {
      expect(await callback(TEST_ACCOUNT_ID, "1000", TEST_ACCOUNT_ID, recall, BINDING))
        .toEqual({ success: false });
    }
    vi.mocked(getCurrentMidenBlock).mockResolvedValueOnce(-1);
    expect(await callback(TEST_ACCOUNT_ID, "1000", TEST_ACCOUNT_ID, 2000, BINDING))
      .toEqual({ success: false });
    expect(requestTransaction).not.toHaveBeenCalled();
  });

  it("returns failure when the committed transaction has no output note", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { callback, waitForTransaction, onNoteCreated } = setup();
    waitForTransaction.mockResolvedValueOnce({ txHash: "0xtx", outputNotes: [] });
    expect(await callback(TEST_ACCOUNT_ID, "1000", TEST_ACCOUNT_ID, 2000, BINDING))
      .toEqual({ success: false });
    expect(onNoteCreated).not.toHaveBeenCalled();
  });
});
