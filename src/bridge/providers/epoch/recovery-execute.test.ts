import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicClient, createWalletClient, decodeFunctionData, encodeFunctionData, encodeFunctionResult, http } from "viem";
import { mainnet } from "viem/chains";
import { getAccount, getWalletClient } from "@wagmi/core";
import { readLockedDeposit, recoveryAbi, recoveryClient, type LockedDeposit } from "./recovery";
import { executeRecovery } from "./recovery-execute";

vi.mock("@wagmi/core", () => ({ getAccount: vi.fn(), getWalletClient: vi.fn() }));
vi.mock("../../../wallets/evm/appkit-config", () => ({ wagmiAdapter: { wagmiConfig: {} } }));
vi.mock("../../../wallets/evm/ensure-network", () => ({ ensureEvmNetwork: vi.fn() }));
vi.mock("./recovery", async importOriginal => ({ ...await importOriginal<typeof import("./recovery")>(),
  readLockedDeposit: vi.fn(), recoveryClient: vi.fn(),
}));

const sponsor = "0x1111111111111111111111111111111111111111";
const compactAddress = "0x2222222222222222222222222222222222222222";
const hash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const deposit: LockedDeposit = {
  asset: { kind: "native", network: "ethereum", symbol: "ETH", decimals: 18 },
  compactAddress, id: 123n, balance: 5n, status: 0, withdrawableAt: 0n,
};
const wallet = createWalletClient({ chain: mainnet, account: sponsor, transport: http() });
const client = createPublicClient({ chain: mainnet, transport: http() });
const provider = { request: vi.fn() };

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(getAccount).mockReturnValue({ address: sponsor, addresses: [sponsor], chain: mainnet, chainId: 1,
    connector: undefined, isConnected: true, isConnecting: false, isDisconnected: false, isReconnecting: true, status: "reconnecting" });
  vi.mocked(getWalletClient).mockResolvedValue(wallet);
  vi.mocked(readLockedDeposit).mockResolvedValue(deposit);
  vi.mocked(recoveryClient).mockReturnValue(client);
  vi.spyOn(wallet, "getChainId").mockResolvedValue(1);
  vi.spyOn(wallet, "writeContract").mockResolvedValue(hash);
});

describe("recovery signing checks", () => {
  it.each([1, 2])("disables an active withdrawal with status %s before bridging again", async status => {
    vi.mocked(readLockedDeposit).mockResolvedValue({ ...deposit, status, balance: 0n });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const body = await new Request(input, init).json();
      const call = decodeFunctionData({ abi: recoveryAbi, data: body.params[0].data });
      expect(call.functionName).toBe("disableForcedWithdrawal");
      expect(call.args).toEqual([deposit.id]);
      return Response.json({ jsonrpc: "2.0", id: body.id,
        result: encodeFunctionResult({ abi: recoveryAbi, functionName: "disableForcedWithdrawal", result: true }) });
    }));
    vi.mocked(wallet.writeContract).mockRejectedValue(new Error("User rejected request"));
    await expect(executeRecovery(deposit, "cancel", sponsor, provider)).rejects.toThrow("User rejected request");
    expect(wallet.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      address: compactAddress, functionName: "disableForcedWithdrawal", args: [deposit.id], account: wallet.account,
    }));
  });

  it("does not send a disable request when withdrawal is already disabled", async () => {
    await expect(executeRecovery(deposit, "cancel", sponsor, provider)).rejects.toThrow("no withdrawal to cancel");
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it("does not restart an active withdrawal from an old row", async () => {
    vi.mocked(readLockedDeposit).mockResolvedValue({ ...deposit, status: 1 });
    await expect(executeRecovery(deposit, "start", sponsor, provider)).rejects.toThrow("already started");
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it("rejects a changed wallet", async () => {
    const other = createWalletClient({ chain: mainnet, account: "0x2222222222222222222222222222222222222222", transport: http() });
    vi.mocked(getWalletClient).mockResolvedValue(other);
    await expect(executeRecovery(deposit, "withdraw", sponsor, provider)).rejects.toThrow("wallet changed");
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it("rejects a changed chain", async () => {
    vi.mocked(wallet.getChainId).mockResolvedValue(8453);
    await expect(executeRecovery(deposit, "withdraw", sponsor, provider)).rejects.toThrow("Switch your wallet");
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it("does not send a withdrawal when contract simulation fails", async () => {
    vi.spyOn(client, "simulateContract").mockRejectedValue(new Error("PrematureWithdrawal"));
    await expect(executeRecovery(deposit, "withdraw", sponsor, provider)).rejects.toThrow("PrematureWithdrawal");
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "replaced", "repriced"] as const)("recognizes a %s withdrawal on-chain", async replacement => {
    const replacementHash = `0x${"bb".repeat(32)}`;
    const original = {
      hash, from: sponsor, to: compactAddress, nonce: "0x1", value: "0x0",
      input: encodeFunctionData({ abi: recoveryAbi, functionName: "forcedWithdrawal", args: [deposit.id, sponsor, deposit.balance] }),
    };
    const transaction = {
      ...original, hash: replacementHash, blockNumber: "0x2",
      to: replacement === "cancelled" ? sponsor : compactAddress,
      input: replacement === "repriced" ? original.input : "0x",
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const { id, method, params } = await new Request(input, init).json();
      const result = (() => {
        switch (method) {
          case "eth_call": return encodeFunctionResult({ abi: recoveryAbi, functionName: "forcedWithdrawal", result: true });
          case "eth_blockNumber": return "0x2";
          case "eth_getTransactionByHash": return params[0] === hash ? original : null;
          case "eth_getBlockByNumber": return { number: "0x2", transactions: [transaction] };
          case "eth_getTransactionReceipt": return params[0] === replacementHash
            ? { transactionHash: replacementHash, blockNumber: "0x2", status: "0x1", logs: [] } : null;
          default: throw new Error(`Unexpected RPC call ${method}`);
        }
      })();
      return Response.json({ jsonrpc: "2.0", id, result });
    }));
    const execution = executeRecovery(deposit, "withdraw", sponsor, provider);
    if (replacement === "repriced") await expect(execution).resolves.toBe(2n);
    else await expect(execution).rejects.toThrow("The recovery transaction was canceled or replaced.");
  });
});
