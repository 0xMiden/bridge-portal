import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionData, erc20Abi, type Hex } from "viem";
import { routesForEnvironment } from "../../core/routes";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";

const rpc = vi.hoisted(() => ({ read: vi.fn(), call: vi.fn(), estimate: vi.fn(), wait: vi.fn(), capture: vi.fn(), resolve: vi.fn() }));
vi.mock("../../evm/transport", () => ({ evmReadTransport: (network: string) => ({ network }) }));
vi.mock("../../evm/source-transaction", () => ({ captureSourceTransaction: rpc.capture, recoverSourceTransaction: rpc.resolve }));
vi.mock("viem", async original => ({
  ...await original<typeof import("viem")>(),
  createPublicClient: ({ chain, transport }: { chain: { id: number }; transport: { network: string } }) => {
    if (chain.id !== 1 || transport.network !== "ethereum") throw new Error("Wrong approval chain or transport");
    return { readContract: rpc.read, call: rpc.call, estimateGas: rpc.estimate, waitForTransactionReceipt: rpc.wait };
  },
}));
const account = `0x${"11".repeat(20)}` as const;
const token = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const bridge = "0x2a3dd3eb832af982ec71669e178424b10dca2ede";
const resetHash = `0x${"aa".repeat(32)}` as const;
const approvalHash = `0x${"bb".repeat(32)}` as const;
const depositHash = `0x${"cc".repeat(32)}` as const;
const replacementHash = `0x${"dd".repeat(32)}` as const;
const route = routesForEnvironment("mainnet").find(route =>
  route.provider === "agglayer" && route.mode === "receive" && route.source.symbol === "USDT");
if (!route) throw new Error("Missing mainnet USDT route");
const input = { route, amount: "1", destination: "0x387149ae66116cf114eebd60bb7381", address: account, phase: vi.fn() };
let storage: Map<string, string>;
let approved: bigint;
let signed: { to: string; data: Hex }[];
const provider: EvmProvider = { request: vi.fn() };

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  storage = new Map();
  approved = 0n;
  signed = [];
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
  rpc.capture.mockResolvedValue(undefined);
  rpc.resolve.mockResolvedValue({});
  rpc.read.mockImplementation(async ({ address, functionName, args }) => {
    if (address.toLowerCase() !== token || args[0] !== account) throw new Error("Wrong token or account");
    if (functionName === "balanceOf") return 10_000_000n;
    if (functionName === "allowance" && args[1].toLowerCase() === bridge) return approved;
    throw new Error("Unexpected contract read");
  });
  rpc.call.mockResolvedValue({ data: "0x" });
  rpc.estimate.mockResolvedValue(100_000n);
  rpc.wait.mockImplementation(async ({ hash }) => {
    if (hash === resetHash) approved = 0n;
    else if (hash === approvalHash) approved = 1_000_000n;
    else throw new Error("Unexpected receipt");
    return { status: "success" };
  });
  vi.mocked(provider.request).mockImplementation(async ({ method, params }) => {
    if (method === "eth_accounts") return [account];
    if (method === "eth_chainId") return "0x1";
    if (method !== "eth_sendTransaction") throw new Error("Unexpected wallet call");
    const [tx] = params as [{ to: string; data: Hex; chainId: string }];
    if (tx.chainId !== "0x1") throw new Error("Wrong signing chain");
    signed.push(tx);
    if (tx.to.toLowerCase() === bridge) return depositHash;
    if (tx.to.toLowerCase() !== token) throw new Error("Wrong signing contract");
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
    if (decoded.functionName !== "approve" || decoded.args[0].toLowerCase() !== bridge) throw new Error("Wrong approval spender");
    return decoded.args[1] === 0n ? resetHash : approvalHash;
  });
});
afterEach(() => vi.unstubAllGlobals());

async function submit(amount = input.amount) {
  const { submitAgglayerDeposit } = await import("./deposit");
  return submitAgglayerDeposit({ ...input, amount, provider });
}

describe("durable Agglayer approvals", () => {
  it.each(["reset", "approval"])("resumes a timed-out %s after reload without signing it twice", async stage => {
    approved = stage === "reset" ? 1n : 0n;
    rpc.wait.mockRejectedValueOnce(new Error("Receipt unavailable"));
    await expect(submit()).rejects.toThrow();
    expect(storage.size).toBe(1);
    expect(signed).toHaveLength(1);
    expect(signed[0].to.toLowerCase()).toBe(token);
    vi.resetModules(); // Keep storage, discard all in-memory pending state.
    await expect(submit()).resolves.toMatchObject({ sourceTxHash: depositHash });
    expect(rpc.wait).toHaveBeenNthCalledWith(2, expect.objectContaining({ hash: stage === "reset" ? resetHash : approvalHash }));
    expect(signed.filter(tx => tx.to.toLowerCase() === token)).toHaveLength(stage === "reset" ? 2 : 1);
    expect(signed.at(-1)?.to.toLowerCase()).toBe(bridge);
    expect(storage.size).toBe(0);
  });

  it.each(["cancelled", "replaced"])("blocks a %s approval recovered after reload", async reason => {
    rpc.wait.mockRejectedValueOnce(new Error("Receipt unavailable"));
    await expect(submit()).rejects.toThrow();
    expect(storage.size).toBe(1);
    vi.resetModules();
    approved = 1_000_000n;
    rpc.resolve.mockResolvedValue({ hash: replacementHash, reason });
    await expect(submit()).rejects.toThrow(/cancelled or replaced/);
    expect(signed).toHaveLength(1);
    expect(storage.size).toBe(0);
  });

  it("uses sufficient allowance after an approval hash disappears without captured metadata", async () => {
    rpc.wait.mockRejectedValue(new Error("Original approval unavailable"));
    await expect(submit()).rejects.toThrow(/confirmation is not verified/);
    expect(storage.size).toBe(1);
    vi.resetModules();
    // A repriced approval mined while this page was closed; its original hash is gone.
    approved = 1_000_000n;
    await expect(submit()).resolves.toMatchObject({ sourceTxHash: depositHash });
    expect(signed.map(tx => tx.to.toLowerCase())).toEqual([token, bridge]);
    expect(rpc.wait).toHaveBeenCalledTimes(1);
    expect(storage.size).toBe(0);
  });

  it("persists a repriced approval before a receipt outage and resumes its replacement after reload", async () => {
    const transaction = {
      hash: replacementHash, from: account, nonce: 7, to: token,
      input: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [bridge, 1_000_000n] }), value: 0n,
    };
    rpc.wait.mockImplementationOnce(async ({ onReplaced }) => {
      onReplaced({ reason: "repriced", transaction });
      throw new Error("Receipt unavailable after replacement");
    });
    await expect(submit()).rejects.toThrow(/confirmation is not verified/);
    vi.resetModules();
    rpc.wait.mockImplementationOnce(async ({ hash }) => {
      expect(hash).toBe(replacementHash);
      approved = 1_000_000n;
      return { status: "success" };
    });
    await expect(submit()).resolves.toMatchObject({ sourceTxHash: depositHash });
    expect(signed.filter(tx => tx.to.toLowerCase() === token)).toHaveLength(1);
    expect(storage.size).toBe(0);
  });

  it("rejects a malformed saved reset amount before requesting another signature", async () => {
    rpc.wait.mockRejectedValueOnce(new Error("Receipt unavailable"));
    await expect(submit()).rejects.toThrow();
    expect(storage.size).toBe(1);
    const [key, raw] = [...storage.entries()][0];
    storage.set(key, JSON.stringify({ ...JSON.parse(raw), amount: "-1" }));
    vi.resetModules();
    await expect(submit()).rejects.toThrow(/Saved token approval details are invalid/);
    expect(signed).toHaveLength(1);
  });

  it.each(["zero reset", "smaller approval"])("waits for a pending %s even when the current allowance could fund the deposit", async stage => {
    approved = stage === "zero reset" ? 1n : 0n;
    rpc.wait.mockRejectedValueOnce(new Error("Receipt unavailable"));
    await expect(submit(stage === "zero reset" ? "1" : "0.5")).rejects.toThrow();
    expect(storage.size).toBe(1);
    vi.resetModules();
    approved = 2_000_000n;
    const receipt = Promise.withResolvers<{ status: string }>();
    rpc.wait.mockReturnValueOnce(receipt.promise);
    const retry = submit();
    await vi.waitFor(() => expect(rpc.wait).toHaveBeenCalledTimes(2));
    expect(signed).toHaveLength(1);
    approved = stage === "zero reset" ? 0n : 500_000n;
    receipt.resolve({ status: "success" });
    await expect(retry).resolves.toMatchObject({ sourceTxHash: depositHash });
    expect(signed).toHaveLength(stage === "zero reset" ? 3 : 4);
  });
});
