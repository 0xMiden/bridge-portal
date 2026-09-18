import { describe, expect, it, vi } from "vitest";

vi.mock("../e2e/env", () => ({
  isE2E: () => true,
  e2eNetwork: () => "mock",
}));

vi.mock("./miden-note", () => ({
  createBridgeP2IDNoteCallback: vi.fn(),
}));

vi.mock("./sdk", () => ({
  getEpochReadOnlySdk: vi.fn(),
  getEpochSdk: vi.fn(),
}));

vi.mock("./bridge", () => ({
  buildCrossChainIntent: vi.fn(),
  buildEVMToMidenIntent: vi.fn(),
  getCrossChainQuote: vi.fn(),
  getEVMToMidenQuote: vi.fn(),
}));

vi.mock("./chain", () => ({ getCurrentMidenBlock: vi.fn() }));

vi.mock("@epoch-protocol/epoch-intents-sdk", () => ({
  TaskType: { GetTokenOut: "gettokenout" },
  CollateralType: {},
  EpochIntentSDK: class {},
}));

import { runEpochTransfer } from "./epoch-execute";

describe("runEpochTransfer (mock E2E)", () => {
  it("returns a canned 32-byte hash without talking to Epoch", async () => {
    const result = await runEpochTransfer({
      mode: "receive",
      amount: "0.01",
      midenAccount: "mtst1aqk5t00kapdcnq2yyf77dz6xcysswce0_qr7qqq9wr6w",
      evmAddress: "0x1111111111111111111111111111111111111111",
    });

    expect(result.direction).toBe("receive");
    expect(result.sourceTxHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.intentNonce).toBe("42");
    expect(result.sponsorAddress).toBe(
      "0x1111111111111111111111111111111111111111",
    );
  });
});
