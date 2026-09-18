import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./e2e/env", () => ({
  isE2E: () => true,
  e2eNetwork: () => "mock",
}));

import { AGGLAYER_BALI } from "./agglayer";
import { fetchMidenRouteBalances } from "./agglayer-eth-faucet";

describe("fetchMidenRouteBalances (mock E2E)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("totals canonical faucets without loading the Miden SDK", async () => {
    const result = await fetchMidenRouteBalances(async () => [
      { faucetId: AGGLAYER_BALI.midenEthFaucetIdHex, amount: "100000000" },
      { faucetId: "0xfc90f0f4da30e51168453b60eafed7", amount: "1000000" },
    ]);

    expect(result.epoch).toBe("1");
    expect(result.agglayer).toBe("1");
    expect(result.agglayerEth).toEqual({
      faucetId: AGGLAYER_BALI.midenEthFaucetIdHex,
      amountRaw: 100000000n,
      decimals: AGGLAYER_BALI.midenEthDecimals,
      symbol: "ETH",
    });
  });
});
