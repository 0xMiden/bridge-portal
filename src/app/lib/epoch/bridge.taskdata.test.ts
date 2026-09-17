import { describe, expect, it, vi } from "vitest";

vi.mock("@miden-sdk/miden-sdk", () => ({
  AccountId: {
    fromHex: (value: string) => ({
      toString: () => value.replace(/^0x/i, "").toLowerCase(),
    }),
  },
}));

vi.mock("@epoch-protocol/epoch-intents-sdk", () => ({
  TaskType: { GetTokenOut: "gettokenout" },
  CollateralType: {},
  EpochIntentSDK: class {},
}));

import { MIDEN_MIN_RECLAIM_BLOCKS } from "./config";
import { buildEpochTaskDataParams } from "./bridge";

describe("buildEpochTaskDataParams", () => {
  it("uses TaskType.GetTokenOut and an absolute reclaim height", () => {
    const params = buildEpochTaskDataParams({
      midenAccountId: "0x387149ae66116cf114eebd60bb7381",
      midenFaucetId: "0xfc90f0f4da30e51168453b60eafed7",
      midenAmount: "1000000",
      evmRecipient: "0x1111111111111111111111111111111111111111",
      destinationChainId: 11155111,
      outputTokenAddress: "0x2222222222222222222222222222222222222222",
      outputTokenDecimals: 6,
      minTokenOut: "0",
      midenReclaimHeight: 12_000 + MIDEN_MIN_RECLAIM_BLOCKS,
    });

    expect(params.taskType).toBe("gettokenout");
    expect(params.extraData).toEqual(
      expect.objectContaining({
        midenReclaimHeight: String(12_000 + MIDEN_MIN_RECLAIM_BLOCKS),
        midenNoteType: "P2IDE",
      }),
    );
  });

  it("rejects a missing reclaim height", () => {
    expect(() =>
      buildEpochTaskDataParams({
        midenAccountId: "0x387149ae66116cf114eebd60bb7381",
        midenFaucetId: "0xfc90f0f4da30e51168453b60eafed7",
        midenAmount: "1",
        evmRecipient: "0x1111111111111111111111111111111111111111",
        destinationChainId: 11155111,
        outputTokenAddress: "0x2222222222222222222222222222222222222222",
        outputTokenDecimals: 6,
        minTokenOut: "0",
        midenReclaimHeight: 0,
      }),
    ).toThrow(/midenReclaimHeight/);
  });
});
