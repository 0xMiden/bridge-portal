import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContractFunctionRevertedError, WaitForTransactionReceiptTimeoutError, encodeErrorResult } from "viem";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { depositViaCctp } from "./cctp-deposit";
import { cctpDepositHook, decodeCctpDepositHook } from "./cctp-hook";
import { cctpAbi, cctpConfig, cctpSource, type CctpNetwork } from "./cctp-config";
const CCTP = cctpConfig();
import { ARC } from "./config";
import { arcRecipient } from "./deposit";
import type { CctpQuote } from "./cctp-quote";
import fixture from "./fixtures/cctp-hook.json";

const mocks = vi.hoisted(() => ({ read: vi.fn(), simulate: vi.fn(), write: vi.fn(), receipt: vi.fn(), quote: vi.fn(), validate: vi.fn() }));
vi.mock("viem", async (original) => ({ ...await original<typeof import("viem")>(),
  createPublicClient: () => ({ readContract: mocks.read, simulateContract: mocks.simulate, waitForTransactionReceipt: mocks.receipt }),
  createWalletClient: () => ({ writeContract: mocks.write }),
}));
vi.mock("./cctp-quote-validation", () => ({ fetchCctpQuoteValidation: mocks.validate }));
vi.mock("./cctp-quote", () => ({ fetchCctpQuote: mocks.quote }));
vi.mock("../../evm/source-transaction", () => ({
  captureSourceTransaction: async () => undefined, resolveSourceTransaction: async () => ({}),
}));
vi.mock("@miden-sdk/miden-sdk", () => ({ AccountId: { fromHex: () => ({ free() {} }) } }));
const account = fixture.sender as `0x${string}`;
const hash = `0x${"ab".repeat(32)}` as const;
let network: CctpNetwork;
let fee: bigint;
let chainId: number;
let walletAccount: string;
let quote: CctpQuote;
let secondsRemaining: number;
let allowance: bigint;
function input() {
  return { network, account, amount: "1", recipient: fixture.recipient, quote,
    provider: { request: async ({ method }: { method: string }) => method === "eth_accounts" ? [walletAccount] : `0x${chainId.toString(16)}` } as EvmProvider,
    onPhase: vi.fn(), onBroadcast: vi.fn(),
  };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.resetAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
  allowance = 0n;
  network = "base-sepolia";
  secondsRemaining = 120;
  fee = 400_000n;
  walletAccount = account;
  chainId = cctpSource(network).chain.id;
  quote = { network, sender: account, amount: "1", recipient: fixture.recipient, fee: "400000", signedQuote: "0x1234", issuedAt: 1792663778,
    expiry: { mode: "BLOCK_NUMBER", expiresAtBlock: 26247476, blockEstimatedAt: 1792663946 },
    expiresAt: 1792663946000 };
  mocks.quote.mockImplementation(async (request) => {
    secondsRemaining = 120;
    return { ...quote, ...request, fee: fee.toString(), signedQuote: "0xabcd" };
  });
  mocks.validate.mockImplementation(async () => ({ claimable: secondsRemaining > 0, secondsRemaining }));
  mocks.read.mockImplementation(async ({ functionName, args }) => {
    if (functionName === "paused") return false;
    if (functionName === "isRemoteDomainRegistered") return true;
    if (functionName === "getRemoteToken") return arcRecipient(ARC.faucetId);
    if (functionName === "getFee") return [args[0] === "0x1234" ? 400_000n : fee, cctpSource(network).asset.address];
    if (functionName === "balanceOf") return 10_000_000n;
    return allowance;
  });
  mocks.simulate.mockImplementation(async (request) => ({ request }));
  mocks.receipt.mockImplementation(async () => { allowance = 1_400_000n; return { status: "success" }; });
  mocks.write.mockResolvedValue(hash);
});

describe("Circle multichain deposits", () => {
  it("matches the hook accepted by Circle's signed forwarding quote, including the amount-injection offset", () => {
    expect(cctpDepositHook(account, fixture.recipient)).toBe(fixture.hook);
    expect(decodeCctpDepositHook(fixture.hook as `0x${string}`)).toEqual({ sender: account, recipient: fixture.recipient });
    // Repointing the handler or xReserve target must never be accepted for tracking.
    const changed = fixture.hook.replace(ARC.xReserve.slice(2).toLowerCase(), "22".repeat(20));
    expect(() => decodeCctpDepositHook(changed as `0x${string}`)).toThrow("Unsupported deposit hook");
  });
  it.each<CctpNetwork>(["sepolia", "base-sepolia", "arbitrum-sepolia"])("burns the full amount from %s and separately approves the reviewed fee", async (origin) => {
    network = origin;
    chainId = cctpSource(network).chain.id;
    quote.network = origin;
    const args = input();
    await depositViaCctp(args);
    expect(mocks.write).toHaveBeenNthCalledWith(1, expect.objectContaining({ address: cctpSource(network).asset.address,
      functionName: "approve", args: [CCTP.tokenMessengerWithFees, 1_400_000n] }));
    expect(mocks.write).toHaveBeenNthCalledWith(2, expect.objectContaining({ address: CCTP.tokenMessengerWithFees,
      functionName: "depositForBurnWithHookAndFees", args: [1_000_000n, 26, expect.any(String), cctpSource(network).asset.address,
        expect.any(String), fixture.hook, { signedQuote: "0x1234", refundAddress: account }] }));
    expect(args.onBroadcast).toHaveBeenCalledWith(hash, "400000");
    expect(mocks.receipt).toHaveBeenCalledTimes(1);
  });
  it.each([
    { remaining: 31, needsApproval: true, refresh: false },
    { remaining: 30, needsApproval: true, refresh: true },
    { remaining: 0, needsApproval: true, refresh: true },
    { remaining: 31, needsApproval: false, refresh: false },
    { remaining: 30, needsApproval: false, refresh: true },
  ])("uses Circle's source-chain validity with $remaining seconds left (approval: $needsApproval)", async ({ remaining, needsApproval, refresh }) => {
    // The device clock and blockEstimatedAt cannot decide BLOCK_NUMBER validity.
    vi.spyOn(Date, "now").mockReturnValue(quote.expiresAt + 3_600_000);
    // A newer market price must not discard an original quote still claimable.
    fee = refresh ? 400_000n : 400_001n;
    if (needsApproval) {
      mocks.receipt.mockImplementation(async () => {
        secondsRemaining = remaining;
        allowance = 1_400_000n;
        return { status: "success" };
      });
    } else {
      secondsRemaining = remaining;
      const read = mocks.read.getMockImplementation()!;
      mocks.read.mockImplementation(async (request) => request.functionName === "allowance" ? 1_400_000n : read(request));
    }
    const args = input();
    await depositViaCctp(args);
    expect(mocks.quote).toHaveBeenCalledTimes(refresh ? 1 : 0);
    expect(mocks.write).toHaveBeenCalledTimes(needsApproval ? 2 : 1);
    expect(mocks.write).toHaveBeenLastCalledWith(expect.objectContaining({
      functionName: "depositForBurnWithHookAndFees",
      args: expect.arrayContaining([{ signedQuote: refresh ? "0xabcd" : "0x1234", refundAddress: account }]),
    }));
    expect(args.onBroadcast).toHaveBeenCalledWith(hash, "400000");
  });
  it("refreshes and simulates again if preparation consumes the remaining validity", async () => {
    mocks.simulate.mockImplementation(async (request) => {
      if (request.functionName === "depositForBurnWithHookAndFees" && request.args.at(-1).signedQuote === "0x1234") secondsRemaining = 0;
      return { request };
    });
    await depositViaCctp(input());
    expect(mocks.quote).toHaveBeenCalledOnce();
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(mocks.write).toHaveBeenLastCalledWith(expect.objectContaining({
      args: expect.arrayContaining([{ signedQuote: "0xabcd", refundAddress: account }]),
    }));
  });
  it.each(["QuoteExpired", "other"])("only refreshes a simulation revert caused by %s", async (kind) => {
    const revert = kind === "QuoteExpired"
      ? new ContractFunctionRevertedError({ abi: cctpAbi, functionName: "depositForBurnWithHookAndFees",
        data: encodeErrorResult({ abi: cctpAbi, errorName: "QuoteExpired", args: [1, 100n, 101n] }) })
      : new Error("Insufficient allowance");
    mocks.simulate.mockImplementation(async (request) => {
      if (request.functionName === "depositForBurnWithHookAndFees" && request.args.at(-1).signedQuote === "0x1234") {
        secondsRemaining = 0;
        throw revert;
      }
      return { request };
    });
    const args = input();
    if (kind === "QuoteExpired") {
      await depositViaCctp(args);
      expect(mocks.quote).toHaveBeenCalledOnce();
      expect(args.onBroadcast).toHaveBeenCalledWith(hash, "400000");
    } else {
      await expect(depositViaCctp(args)).rejects.toThrow("Insufficient allowance");
      expect(mocks.quote).not.toHaveBeenCalled();
      expect(args.onBroadcast).not.toHaveBeenCalled();
    }
  });
  it("does not send if the wallet changes during the final validation", async () => {
    mocks.simulate.mockImplementation(async (request) => {
      if (request.functionName === "depositForBurnWithHookAndFees") {
        mocks.validate.mockImplementation(async () => {
          walletAccount = `0x${"22".repeat(20)}`;
          return { claimable: true, secondsRemaining: 120 };
        });
      }
      return { request };
    });
    await expect(depositViaCctp(input())).rejects.toThrow("account or network changed");
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("accounts for time spent waiting for the validation response", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    mocks.validate.mockImplementation(async (candidate) => {
      if (candidate.signedQuote === "0x1234") {
        clock.mockReturnValue(2_000);
        return { claimable: true, secondsRemaining: 31 };
      }
      return { claimable: true, secondsRemaining: 120 };
    });
    await depositViaCctp(input());
    expect(mocks.quote).toHaveBeenCalledOnce();
    expect(mocks.write).toHaveBeenLastCalledWith(expect.objectContaining({
      args: expect.arrayContaining([{ signedQuote: "0xabcd", refundAddress: account }]),
    }));
  });
  it("does not sign or loop when Circle returns a replacement too near expiry", async () => {
    mocks.validate.mockResolvedValue({ claimable: true, secondsRemaining: 30 });
    await expect(depositViaCctp(input())).rejects.toThrow(/expir/i);
    expect(mocks.quote).toHaveBeenCalledOnce();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("stops after approval if authoritative validation is unavailable", async () => {
    mocks.receipt.mockImplementation(async () => {
      mocks.validate.mockRejectedValue(new Error("Circle quote validation unavailable"));
      allowance = 1_400_000n;
      return { status: "success" };
    });
    await expect(depositViaCctp(input())).rejects.toThrow("validation unavailable");
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.quote).not.toHaveBeenCalled();
  });
  it.each(["fee", "account", "chain", "approval"])("never burns after %s changes during approval", async (change) => {
    mocks.receipt.mockImplementation(async () => {
      if (change === "fee") {
        fee++;
        secondsRemaining = 0;
      }
      if (change === "account") walletAccount = `0x${"22".repeat(20)}`;
      if (change === "chain") chainId = 1;
      allowance = 1_400_000n;
      return { status: change === "approval" ? "reverted" : "success" };
    });
    const args = input();
    await expect(depositViaCctp(args)).rejects.toThrow(change === "fee" ? "fee increased" : change === "approval" ? "approval reverted" : "account or network changed");
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(args.onBroadcast).not.toHaveBeenCalled();
  });
  it("resumes a timed-out approval and refreshes its expired quote before depositing", async () => {
    mocks.receipt.mockRejectedValueOnce(new WaitForTransactionReceiptTimeoutError({ hash }));
    const args = input();
    await expect(depositViaCctp(args)).rejects.toThrow();
    expect(args.onBroadcast).not.toHaveBeenCalled();
    secondsRemaining = 0;
    await depositViaCctp(args);
    expect(mocks.receipt).toHaveBeenNthCalledWith(2, expect.objectContaining({ hash }));
    expect(mocks.write).toHaveBeenCalledTimes(2); // One approval, then one burn.
    expect(mocks.write).toHaveBeenLastCalledWith(expect.objectContaining({
      functionName: "depositForBurnWithHookAndFees",
      args: expect.arrayContaining([{ signedQuote: "0xabcd", refundAddress: account }]),
    }));
    expect(args.onBroadcast).toHaveBeenCalledOnce();
  });
  it("rejects an old recipient quote before any wallet write", async () => {
    quote.recipient = "0xb64e1827414584510723cad8e145a4";
    await expect(depositViaCctp(input())).rejects.toThrow("transfer changed");
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
