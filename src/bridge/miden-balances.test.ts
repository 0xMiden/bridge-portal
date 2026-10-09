import { beforeEach, describe, expect, it, vi } from "vitest";
import { MIDEN_ETH, MIDEN_USDC } from "./core/assets";
import { fetchMidenBalances, midenBalanceKey } from "./miden-balances";

const sdk = vi.hoisted(() => ({
  getAccountDetails: vi.fn(),
  fromAccount: vi.fn(),
}));

vi.mock("../wallets/testing/env", () => ({ isE2E: () => false }));
vi.mock("@miden-sdk/miden-sdk", () => ({
  AccountId: {
    fromHex: (hex: string) => ({ toString: () => hex }),
    fromBech32: (bech32: string) => {
      if (bech32 !== "mtst1ap7x68w8ldcytyfa2f9mauqh75qhs3hh_qr7qqq9wr6w") throw new Error("Invalid account ID");
      return { toString: () => "0x7c6d1dc7fb7045913d524bbef017f5" };
    },
  },
  Endpoint: { testnet: () => ({}) },
  RpcClient: class { getAccountDetails = sdk.getAccountDetails; },
  BasicFungibleFaucetComponent: { fromAccount: sdk.fromAccount },
}));

beforeEach(() => vi.resetAllMocks());

describe("Miden asset resolution", () => {
  it("totals hex and bech32 holdings with on-chain decimals shared by every route for the token", async () => {
    sdk.getAccountDetails.mockResolvedValue({ account: () => ({}) });
    sdk.fromAccount.mockReturnValue({ decimals: () => 6, symbol: () => ({ toString: () => "WETH" }) });
    const requestAssets = vi.fn(async () => [
      { faucetId: "mtst1ap7x68w8ldcytyfa2f9mauqh75qhs3hh_qr7qqq9wr6w", amount: "1200000" },
      { faucetId: MIDEN_ETH.faucetId, amount: "345678" },
      { faucetId: "0x1234", amount: "999999999" },
    ]);

    const balances = await fetchMidenBalances("0xabcd", [MIDEN_ETH, MIDEN_USDC, { ...MIDEN_ETH }], requestAssets);

    expect(requestAssets).toHaveBeenCalledOnce();
    expect(sdk.getAccountDetails).toHaveBeenCalledOnce();
    expect(balances[midenBalanceKey("0xabcd", MIDEN_ETH)]).toEqual({
      faucetId: MIDEN_ETH.faucetId, amountRaw: 1545678n,
      decimals: 6, symbol: "WETH", balance: "1.545678",
    });
    expect(balances[midenBalanceKey("0xabcd", MIDEN_USDC)]).toEqual({
      faucetId: MIDEN_USDC.faucetId, amountRaw: 0n,
      decimals: 6, symbol: "USDC", balance: "0",
    });
  });

  it.each(["unavailable", "private"])("keeps configured precision when faucet metadata is %s", async (failure) => {
    if (failure === "unavailable") sdk.getAccountDetails.mockRejectedValue(new Error("RPC unavailable"));
    else sdk.getAccountDetails.mockResolvedValue({ account: () => undefined });

    const balances = await fetchMidenBalances("0xabcd", [MIDEN_ETH, MIDEN_USDC], async () => [
      { faucetId: MIDEN_ETH.faucetId, amount: "123456789" },
      { faucetId: MIDEN_USDC.faucetId, amount: "2345678" },
    ]);

    expect(balances[midenBalanceKey("0xabcd", MIDEN_ETH)]).toMatchObject({ decimals: 8, balance: "1.23456789" });
    expect(balances[midenBalanceKey("0xabcd", MIDEN_USDC)]).toMatchObject({ decimals: 6, balance: "2.345678" });
  });

  it("propagates a rejected permission request without reporting a zero balance", async () => {
    const denied = new Error("User denied access");
    await expect(fetchMidenBalances("0xabcd", [MIDEN_ETH], async () => { throw denied; })).rejects.toBe(denied);
    expect(sdk.getAccountDetails).not.toHaveBeenCalled();
  });
});
