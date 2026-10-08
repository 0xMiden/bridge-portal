import { describe, expect, it, vi } from "vitest";
import { MIDEN_ETH, MIDEN_USDC } from "./core/assets";
import { fetchMidenBalances, midenBalanceKey } from "./miden-balances";

vi.mock("../wallets/testing/env", () => ({
  isE2E: () => true,
  e2eNetwork: () => "mock",
}));
vi.mock("@miden-sdk/miden-sdk", () => {
  throw new Error("Mock balance reads must not load WASM");
});

describe("Miden balances (mock E2E)", () => {
  it("shares token balances across routes while isolating accounts and faucets", async () => {
    const requestAssets = vi.fn(async () => [
      { faucetId: MIDEN_ETH.faucetId, amount: "100000000" },
      { faucetId: ` ${MIDEN_ETH.faucetId.toUpperCase()} `, amount: "50000000" },
      { faucetId: MIDEN_USDC.faucetId.slice(2), amount: "2000000" },
      { faucetId: "0x1234", amount: "999999999" },
    ]);
    const anotherRouteToken = { ...MIDEN_ETH, faucetId: MIDEN_ETH.faucetId.toUpperCase() };
    const balances = await fetchMidenBalances("0xabcd", [MIDEN_ETH, MIDEN_USDC, anotherRouteToken], requestAssets);

    expect(requestAssets).toHaveBeenCalledOnce();
    expect(Object.keys(balances)).toHaveLength(2);
    expect(balances[midenBalanceKey("0xABCD", anotherRouteToken)]).toEqual({
      faucetId: MIDEN_ETH.faucetId,
      amountRaw: 150000000n,
      decimals: 8,
      symbol: "ETH",
      balance: "1.5",
    });
    expect(balances[midenBalanceKey("0xabcd", MIDEN_USDC)]?.balance).toBe("2");
    expect(balances[midenBalanceKey("0xdef0", MIDEN_ETH)]).toBeUndefined();
    expect(balances[midenBalanceKey("0xabcd", { ...MIDEN_ETH, faucetId: "0x1234" })]).toBeUndefined();
  });
});
