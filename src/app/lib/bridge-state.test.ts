import { describe, expect, it } from "vitest";
import { type Activity, sourceExplorer } from "./bridge-state";

// Minimal Agglayer send activity; only the fields sourceExplorer reads matter.
function agglayerSend(overrides: Partial<Activity>): Activity {
  return {
    id: "act-test",
    mode: "send",
    provider: "agglayer",
    summary: "",
    status: "source_finality",
    eta: "",
    amount: "1",
    asset: "ETH",
    txHash: "0xpending",
    updatedAt: 0,
    ...overrides,
  };
}

const REAL_TX =
  "0x5c33e4d463046d68706c3433dea8532a0bb1879e58eb92a5d9992caf46072a85";
const REQUEST_UUID = "082ecf32-e8ef-4f53-bb49-9f59902db37e";

describe("sourceExplorer (Agglayer send Midenscan link)", () => {
  it("deep-links the real Miden tx hash", () => {
    const link = sourceExplorer(agglayerSend({ midenTxId: REAL_TX }));
    expect(link.available).toBe(true);
    expect(link.href).toBe(`https://testnet.midenscan.com/tx/${REAL_TX}`);
  });

  it("never links a wallet-adapter request UUID (the broken-link bug)", () => {
    const link = sourceExplorer(agglayerSend({ midenTxId: REQUEST_UUID }));
    expect(link.available).toBe(false);
    expect(link.href).toBeUndefined();
  });
});
