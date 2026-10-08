import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { ARC } from "./config";
import {
  arcRecipient,
  depositOnArc,
  ensureArc,
  parseArcAmount,
} from "./deposit";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  simulate: vi.fn(),
  write: vi.fn(),
  receipt: vi.fn(),
  fromHex: vi.fn(),
}));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => ({
    readContract: mocks.read,
    simulateContract: mocks.simulate,
    waitForTransactionReceipt: mocks.receipt,
  }),
  createWalletClient: () => ({ writeContract: mocks.write }),
}));
vi.mock("@miden-sdk/miden-sdk", () => ({
  AccountId: { fromHex: mocks.fromHex },
}));
const account = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0xb64e1827414584510723cad8e145a4";
const hash = `0x${"a".repeat(64)}` as const;
function wallet() {
  return {
    request: vi
      .fn<EvmProvider["request"]>()
      .mockImplementation(async ({ method }) =>
        method === "eth_accounts" ? [account] : `0x${ARC.chainId.toString(16)}`,
      ),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.fromHex.mockReturnValue({ free: vi.fn() });
  mocks.read.mockImplementation(async ({ functionName }) =>
    functionName === "isRemoteDomainRegistered"
      ? true
      : functionName === "getRemoteToken"
        ? arcRecipient(ARC.faucetId)
      : functionName === "balanceOf"
        ? 10_000_000n
        : 0n,
  );
  mocks.simulate.mockImplementation(async (request) => ({ request }));
  mocks.receipt.mockResolvedValue({ status: "success" });
  mocks.write.mockResolvedValue(hash);
});
describe("Arc testnet deposits", () => {
  it("matches the frontend guide recipient vectors including suffix padding", () => {
    expect(arcRecipient(recipient)).toBe(
      "0x00000000000000000000000000000000b64e1827414584510723cad8e145a400",
    );
    expect(arcRecipient("0x179f749ee2329e317d96fe3ed5aaf9")).toBe(
      "0x00000000000000000000000000000000179f749ee2329e317d96fe3ed5aaf900",
    );
    expect(() => arcRecipient(account)).toThrow();
  });
  it("keeps six-decimal precision and rejects rounding, exponent, zero and overflow", () => {
    expect(parseArcAmount("1.000001")).toBe(1_000_001n);
    expect(parseArcAmount("9007199254.740993")).toBe(9007199254740993n);
    for (const amount of [
      "0",
      "1.0000001",
      "1e3",
      "-1",
      "Infinity",
      "18446744073709.551616",
    ])
      expect(() => parseArcAmount(amount)).toThrow();
  });
  it("checks registration before requesting approval", async () => {
    mocks.read.mockResolvedValue(false);
    await expect(
      depositOnArc({
        provider: wallet() as EvmProvider,
        account,
        amount: "1",
        recipient,
        onPhase: vi.fn(),
        onBroadcast: vi.fn(),
      }),
    ).rejects.toThrow("not registered");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("approves exactly the deposit amount and persists the hash immediately", async () => {
    const onBroadcast = vi.fn();
    await depositOnArc({
      provider: wallet() as EvmProvider,
      account,
      amount: "1.25",
      recipient,
      onPhase: vi.fn(),
      onBroadcast,
    });
    expect(mocks.write).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        functionName: "approve",
        args: [ARC.xReserve, 1_250_000n],
      }),
    );
    expect(mocks.write).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        functionName: "depositToRemote",
        args: [1_250_000n, 10007, arcRecipient(recipient), ARC.usdc, 0n, "0x"],
      }),
    );
    expect(onBroadcast).toHaveBeenCalledWith(hash);
    expect(mocks.receipt).toHaveBeenCalledTimes(1); // only approval; tracking owns deposit confirmation
  });
  it("does not deposit after a reverted approval", async () => {
    mocks.receipt.mockResolvedValue({ status: "reverted" });
    await expect(
      depositOnArc({
        provider: wallet() as EvmProvider,
        account,
        amount: "1",
        recipient,
        onPhase: vi.fn(),
        onBroadcast: vi.fn(),
      }),
    ).rejects.toThrow("approval reverted");
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("rechecks account after approval so a changed wallet cannot deposit", async () => {
    const provider = wallet();
    mocks.receipt.mockImplementation(async () => {
      provider.request.mockImplementation(async ({ method }) =>
        method === "eth_accounts"
          ? ["0x2222222222222222222222222222222222222222"]
          : `0x${ARC.chainId.toString(16)}`,
      );
      return { status: "success" };
    });
    await expect(
      depositOnArc({
        provider: provider as EvmProvider,
        account,
        amount: "1",
        recipient,
        onPhase: vi.fn(),
        onBroadcast: vi.fn(),
      }),
    ).rejects.toThrow("account changed");
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("adds Arc when missing and verifies the wallet really switched", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce("0xaa36a7")
      .mockRejectedValueOnce({ code: 4902 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("0x4cef52");
    await ensureArc({ request });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "wallet_addEthereumChain",
        params: [
          expect.objectContaining({
            chainName: "Arc Testnet",
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
          }),
        ],
      }),
    );
  });

});
it("rejects amounts beyond Miden AssetAmount::MAX before requesting signatures", () => {
  expect(parseArcAmount("9223372034707.29216")).toBe((1n << 63n) - (1n << 31n));
  expect(() => parseArcAmount("9223372034707.292161")).toThrow("supported range");
});

it("rejects a stale Circle faucet mapping before any approval or deposit", async () => {
  mocks.read.mockImplementation(async ({ functionName }) => functionName === "isRemoteDomainRegistered" ? true : arcRecipient("0x179f749ee2329e317d96fe3ed5aaf9"));
  await expect(depositOnArc({ provider: wallet() as EvmProvider, account, amount: "1", recipient, onPhase: vi.fn(), onBroadcast: vi.fn() })).rejects.toThrow(/current Miden USDCx faucet/);
  expect(mocks.write).not.toHaveBeenCalled();
});
it.each([0n, 10_000_000n])("rejects a network change during approval or deposit simulation (allowance %s)", async (allowance) => {
  const provider = wallet();
  mocks.read.mockImplementation(async ({ functionName }) => functionName === "isRemoteDomainRegistered" ? true : functionName === "getRemoteToken" ? arcRecipient(ARC.faucetId) : functionName === "allowance" ? allowance : 10_000_000n);
  mocks.simulate.mockImplementation(async (request) => {
    provider.request.mockImplementation(async ({ method }) => method === "eth_accounts" ? [account] : "0xaa36a7");
    return { request };
  });
  await expect(depositOnArc({ provider: provider as EvmProvider, account, amount: "1", recipient, onPhase: vi.fn(), onBroadcast: vi.fn() })).rejects.toThrow(/network changed/);
  expect(mocks.write).not.toHaveBeenCalled();
});
