import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@miden-sdk/miden-sdk", () => ({
  AccountId: {
    fromHex: () => ({
      toBech32: () => "mtst1testaccount",
    }),
  },
  AccountInterface: {
    BasicWallet: "basic-wallet",
  },
  NetworkId: {
    testnet: () => "testnet",
  },
}));

vi.mock("@miden-sdk/miden-wallet-adapter-react", () => ({
  useMidenFiWallet: vi.fn(),
}));

import {
  createBridgeP2IDNoteCallback,
  type MidenNoteDeps,
} from "./miden-note";

const TEST_ACCOUNT_ID = "0x387149ae66116cf114eebd60bb7381";

describe("createBridgeP2IDNoteCallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an amount above Number.MAX_SAFE_INTEGER before wallet submission", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const requestSend = vi.fn();
    const callback = createBridgeP2IDNoteCallback({
      senderAddress: TEST_ACCOUNT_ID,
      requestSend: requestSend as unknown as MidenNoteDeps["requestSend"],
      waitForTransaction: vi.fn() as unknown as MidenNoteDeps["waitForTransaction"],
    });

    const result = await callback(
      TEST_ACCOUNT_ID,
      (BigInt(Number.MAX_SAFE_INTEGER) + 2n).toString(),
      TEST_ACCOUNT_ID,
    );

    expect(result).toEqual({ success: false });
    expect(requestSend).not.toHaveBeenCalled();
  });

  it("submits Number.MAX_SAFE_INTEGER without changing the amount", async () => {
    const requestSend = vi.fn().mockResolvedValue("wallet-request-id");
    const callback = createBridgeP2IDNoteCallback({
      senderAddress: TEST_ACCOUNT_ID,
      requestSend: requestSend as unknown as MidenNoteDeps["requestSend"],
      waitForTransaction: vi.fn().mockResolvedValue({
        txHash: "0xtx",
        outputNotes: [{ id: () => ({ toString: () => "0xnote" }) }],
      }) as unknown as MidenNoteDeps["waitForTransaction"],
    });

    const result = await callback(
      TEST_ACCOUNT_ID,
      Number.MAX_SAFE_INTEGER.toString(),
      TEST_ACCOUNT_ID,
    );

    expect(result).toEqual({ success: true, noteId: "0xnote" });
    expect(requestSend).toHaveBeenCalledWith(
      expect.objectContaining({ amount: Number.MAX_SAFE_INTEGER }),
    );
  });
});
