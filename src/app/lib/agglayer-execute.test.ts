import { beforeEach, describe, expect, it, vi } from "vitest";

const withCallbacks = vi.fn();
const createB2AggNote = vi.fn(() => "b2agg-note");
const fromHex = vi.fn((value: string) => ({ id: value, kind: "hex" }));
const fromBech32 = vi.fn((value: string) => ({ id: value, kind: "bech32" }));
const ethFromHex = vi.fn((value: string) => ({ evm: value }));
const withOwnOutputNotes = vi.fn().mockReturnThis();
const build = vi.fn(() => "tx-request");
const createCustomTransaction = vi.fn(() => "wallet-tx");

vi.mock("@miden-sdk/miden-sdk", () => ({
  AccountId: { fromHex, fromBech32 },
  AssetCallbackFlag: { Enabled: "Enabled" },
  EthAddress: { fromHex: ethFromHex },
  FungibleAsset: class {
    faucet: unknown;
    amount: unknown;
    flag?: unknown;
    constructor(faucet: unknown, amount: unknown) {
      this.faucet = faucet;
      this.amount = amount;
    }
    withCallbacks(flag: unknown) {
      withCallbacks(flag);
      this.flag = flag;
      return this;
    }
  },
  Note: { createB2AggNote },
  NoteArray: class {
    notes: unknown;
    constructor(notes: unknown) {
      this.notes = notes;
    }
  },
  NoteAssets: class {
    assets: unknown;
    constructor(assets: unknown) {
      this.assets = assets;
    }
  },
  TransactionRequestBuilder: class {
    withOwnOutputNotes() {
      withOwnOutputNotes();
      return this;
    }
    build() {
      return build();
    }
  },
}));

vi.mock("@miden-sdk/miden-wallet-adapter-base", () => ({
  Transaction: { createCustomTransaction },
}));

import { MIDEN_BRIDGE_ID } from "./agglayer-b2agg";
import { runAgglayerSend } from "./agglayer-execute";

const SENDER_HEX = "387149ae66116cf114eebd60bb7381";
const DEST = "0x2222222222222222222222222222222222222222";
const FAUCET = "0x387149ae66116cf114eebd60bb7381";

describe("runAgglayerSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a B2AGG note with callback-enabled assets and the EVM destination", async () => {
    const requestTransaction = vi.fn(async () => "uuid-not-a-hash");
    const waitForTransaction = vi.fn(async () => ({ txHash: `0x${"ab".repeat(32)}` }));

    const result = await runAgglayerSend({
      amount: 1_000_000n,
      faucetId: FAUCET,
      destinationAddress: DEST,
      senderAddress: `0x${SENDER_HEX}`,
      requestTransaction: requestTransaction as never,
      waitForTransaction: waitForTransaction as never,
    });

    expect(withCallbacks).toHaveBeenCalledWith("Enabled");
    expect(createB2AggNote).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "hex" }),
      expect.objectContaining({ id: MIDEN_BRIDGE_ID }),
      expect.anything(),
      0,
      expect.objectContaining({ evm: DEST }),
    );
    expect(createCustomTransaction).toHaveBeenCalled();
    expect(result.txId).toBe("uuid-not-a-hash");
    expect(result.txHash).toBe(`0x${"ab".repeat(32)}`);
  });
});
