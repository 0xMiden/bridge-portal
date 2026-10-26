import { beforeEach, describe, expect, it, vi } from "vitest";
import { MIDEN_ETH, MIDEN_USDC } from "./core/assets";
import { fetchMidenBalances, midenBalanceKey } from "./miden-balances";
import { midenNetworks } from "../config/environment";

const sdk = vi.hoisted(() => ({
  getAccountDetails: vi.fn(),
  fromAccount: vi.fn(),
  endpoint: vi.fn(),
}));

vi.mock("@miden-sdk/miden-sdk", () => ({
  AccountId: {
    fromHex: (hex: string) => ({ toString: () => hex }),
    fromBech32: (bech32: string) => {
      if (bech32 !== "mtst1ap7x68w8ldcytyfa2f9mauqh75qhs3hh_qr7qqq9wr6w") throw new Error("Invalid account ID");
      return { toString: () => "0x7c6d1dc7fb7045913d524bbef017f5" };
    },
  },
  Endpoint: class {
    constructor(public url: string) {}
    static testnet() { return new this(midenNetworks.testnet.rpcUrl); }
  },
  RpcClient: class {
    constructor(private endpoint: { url: string }) { sdk.endpoint(endpoint.url); }
    getAccountDetails(id: unknown) { return sdk.getAccountDetails(id, this.endpoint.url); }
    free() {}
  },
  BasicFungibleFaucetComponent: { fromAccount: sdk.fromAccount },
}));

beforeEach(() => vi.resetAllMocks());

describe("Miden asset resolution", () => {
  it("formats mainnet balances using metadata from the token's network", async () => {
    const token = { ...MIDEN_ETH, network: "miden-mainnet" as const };
    sdk.getAccountDetails.mockImplementation(async (_id, url) => ({
      account: () => ({ decimals: url === midenNetworks.mainnet.rpcUrl ? 6 : 8 }),
      free() {},
    }));
    sdk.fromAccount.mockImplementation(account => ({
      decimals: () => account.decimals,
      symbol: () => ({ toString: () => "WETH", free() {} }),
      free() {},
    }));

    const balances = await fetchMidenBalances("0xabcd", [token], async () => [
      { faucetId: token.faucetId, amount: "1500000" },
    ]);

    expect(balances[midenBalanceKey("0xabcd", token)])
      .toMatchObject({ decimals: 6, balance: "1.5" });
  });

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
      decimals: 6, symbol: "WETH", pricingSymbol: "ETH", balance: "1.545678",
    });
    expect(balances[midenBalanceKey("0xabcd", MIDEN_USDC)]).toEqual({
      faucetId: MIDEN_USDC.faucetId, amountRaw: 0n,
      decimals: 6, symbol: "USDC", pricingSymbol: "USDC", balance: "0",
    });
    expect(Object.values(balances)).toHaveLength(3);
    expect(balances[midenBalanceKey("0xdef0", MIDEN_ETH)]).toBeUndefined();
    expect(balances[midenBalanceKey("0xabcd", { ...MIDEN_ETH, faucetId: "0x1234" })]).toMatchObject({
      amountRaw: 999999999n, symbol: "Unknown asset", balance: "999999999",
    });
    expect(balances[midenBalanceKey("0xabcd", { ...MIDEN_ETH, faucetId: "0x1234" })]?.pricingSymbol).toBeUndefined();
  });

  it("resolves mainnet metadata against the mainnet RPC", async () => {
    const token = { ...MIDEN_ETH, network: "miden-mainnet" as const };
    sdk.getAccountDetails.mockResolvedValue({ account: () => undefined });
    const balances = await fetchMidenBalances("0xabcd", [token], async () => [
      { faucetId: token.faucetId, amount: "100000000" },
    ], "miden-mainnet");
    expect(sdk.endpoint).toHaveBeenCalledWith(process.env.NEXT_PUBLIC_MIDEN_MAINNET_RPC_URL ?? "https://rpc.cedar.miden.io");
    expect(balances[midenBalanceKey("0xabcd", token)]?.balance).toBe("1");
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
