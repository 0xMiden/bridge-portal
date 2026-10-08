import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { depositViaCctp } from "./cctp-deposit";
import { cctpDepositHook, decodeCctpDepositHook } from "./cctp-hook";
import { CCTP, cctpSources, type CctpNetwork } from "./cctp-config";
import { ARC } from "./config";
import { arcRecipient } from "./deposit";
import type { CctpQuote } from "./cctp-quote";
import fixture from "./fixtures/cctp-hook.json";

const mocks = vi.hoisted(() => ({ read: vi.fn(), simulate: vi.fn(), write: vi.fn(), receipt: vi.fn(), quote: vi.fn() }));
vi.mock("viem", async (original) => ({ ...await original<typeof import("viem")>(),
  createPublicClient: () => ({ readContract: mocks.read, simulateContract: mocks.simulate, waitForTransactionReceipt: mocks.receipt }),
  createWalletClient: () => ({ writeContract: mocks.write }),
}));
vi.mock("./cctp-quote", () => ({ fetchCctpQuote: mocks.quote }));
vi.mock("@miden-sdk/miden-sdk", () => ({ AccountId: { fromHex: () => ({ free() {} }) } }));
const account = fixture.sender as `0x${string}`;
const hash = `0x${"ab".repeat(32)}` as const;
let network: CctpNetwork;
let fee: bigint;
let chainId: number;
let walletAccount: string;
let quote: CctpQuote;
function input() {
  return { network, account, amount: "1", recipient: fixture.recipient, quote,
    provider: { request: async ({ method }: { method: string }) => method === "eth_accounts" ? [walletAccount] : `0x${chainId.toString(16)}` } as EvmProvider,
    onPhase: vi.fn(), onBroadcast: vi.fn(),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  network = "base-sepolia";
  fee = 400_000n;
  walletAccount = account;
  chainId = cctpSources[network].chain.id;
  quote = { network, sender: account, amount: "1", recipient: fixture.recipient, fee: "400000", signedQuote: "0x1234", expiresAt: Date.now() + 120000 };
  mocks.quote.mockImplementation(async (request) => ({ ...quote, ...request, fee: fee.toString() }));
  mocks.read.mockImplementation(async ({ functionName }) => {
    if (functionName === "paused") return false;
    if (functionName === "isRemoteDomainRegistered") return true;
    if (functionName === "getRemoteToken") return arcRecipient(ARC.faucetId);
    if (functionName === "getFee") return [fee, cctpSources[network].asset.address];
    if (functionName === "balanceOf") return 10_000_000n;
    return 0n;
  });
  mocks.simulate.mockImplementation(async (request) => ({ request }));
  mocks.receipt.mockResolvedValue({ status: "success" });
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
    chainId = cctpSources[network].chain.id;
    quote.network = origin;
    const args = input();
    await depositViaCctp(args);
    expect(mocks.write).toHaveBeenNthCalledWith(1, expect.objectContaining({ address: cctpSources[network].asset.address,
      functionName: "approve", args: [CCTP.tokenMessengerWithFees, 1_400_000n] }));
    expect(mocks.write).toHaveBeenNthCalledWith(2, expect.objectContaining({ address: CCTP.tokenMessengerWithFees,
      functionName: "depositForBurnWithHookAndFees", args: [1_000_000n, 26, expect.any(String), cctpSources[network].asset.address,
        expect.any(String), fixture.hook, { signedQuote: "0x1234", refundAddress: account }] }));
    expect(args.onBroadcast).toHaveBeenCalledWith(hash, "400000");
    expect(mocks.receipt).toHaveBeenCalledTimes(1);
  });
  it.each(["fee", "account", "chain", "approval"])("never burns after %s changes during approval", async (change) => {
    mocks.receipt.mockImplementation(async () => {
      if (change === "fee") fee++;
      if (change === "account") walletAccount = `0x${"22".repeat(20)}`;
      if (change === "chain") chainId = 1;
      return { status: change === "approval" ? "reverted" : "success" };
    });
    const args = input();
    await expect(depositViaCctp(args)).rejects.toThrow(change === "fee" ? "fee changed" : change === "approval" ? "approval reverted" : "account or network changed");
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(args.onBroadcast).not.toHaveBeenCalled();
  });
  it("rejects an old recipient quote before any wallet write", async () => {
    quote.recipient = "0xb64e1827414584510723cad8e145a4";
    await expect(depositViaCctp(input())).rejects.toThrow("transfer changed");
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
