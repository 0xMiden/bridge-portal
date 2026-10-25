import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultBridgeRoute, findBridgeRoute, type BridgeRoute } from "../../core/routes";
import { getEpochReadOnlySdk, getEpochSdk } from "./sdk";
import type { BridgeAsset } from "../../core/assets";
import { runEpochTransfer } from "./epoch-execute";
import { quoteEpochReceive, quoteEpochSend } from "./epoch-quote";
import { createBridgeP2IDENoteCallback } from "./miden-note";
import { buildCrossChainIntent, buildEVMToMidenIntent, getCrossChainQuote, getEVMToMidenQuote } from "./bridge";

vi.mock("./miden-note", () => ({ createBridgeP2IDENoteCallback: vi.fn() }));
vi.mock("./sdk", () => ({ getEpochReadOnlySdk: vi.fn(async () => ({})), getEpochSdk: vi.fn(async () => ({})) }));
vi.mock("@epoch-protocol/epoch-intents-sdk", () => ({ CollateralType: { Miden: "miden" } }));
vi.mock("./bridge", () => ({
  getCrossChainQuote: vi.fn(), getEVMToMidenQuote: vi.fn(),
  buildCrossChainIntent: vi.fn(), buildEVMToMidenIntent: vi.fn(),
}));

const account = "0x1111111111111111111111111111111111111111";
const midenAccount = "0x387149ae66116cf114eebd60bb7381";

beforeEach(() => {
  vi.clearAllMocks();
  // Provider responses only; the production code constructs all token/amount inputs.
  const quote = { quoteResult: { tokenOut: "125000000" } };
  vi.mocked(getCrossChainQuote).mockResolvedValue(quote as Awaited<ReturnType<typeof getCrossChainQuote>>);
  vi.mocked(getEVMToMidenQuote).mockResolvedValue(quote as Awaited<ReturnType<typeof getEVMToMidenQuote>>);
  const result = { taskTypeString: "test", intentData: {}, solveResult: { nonce: "42" } };
  vi.mocked(buildCrossChainIntent).mockResolvedValue(result);
  vi.mocked(buildEVMToMidenIntent).mockResolvedValue(result);
});

const customEvm: BridgeAsset = {
  network: "sepolia", kind: "erc20", address: "0x2222222222222222222222222222222222222222",
  symbol: "TEST", decimals: 8,
};
const customMiden: BridgeAsset = {
  network: "miden-testnet", kind: "miden", faucetId: "0x123456789012345678901234567890",
  symbol: "MTEST", decimals: 2,
};

// The synthetic pair is intentionally not registered. It proves Epoch's inputs
// come from the route, rather than defaulting to the current USDC constants.
describe.each([
  { name: "registered USDC", route: "epoch-test-usdc", evm: "0x2BB4FfD7E2c6D432b697554Efd77fA13bdbefd69", evmDecimals: 18,
    faucet: "0x5b043dcb48d5721106f7a1ceb2b804", midenDecimals: 6, sendUnits: 1250000n,
    sendOutput: "0.000000000125", receiveOutput: "125", symbol: "USDC", midenSymbol: "USDC" },
  { name: "registered DAI", route: "epoch-dai", evm: "0xc30f1Ce05d1434d484E9A47283aA925fc8A8699a", evmDecimals: 18,
    faucet: "0xd41499b8f142ad9119fd9da357a3b2", midenDecimals: 6, sendUnits: 1250000n,
    sendOutput: "0.000000000125", receiveOutput: "125", symbol: "DAI", midenSymbol: "DAI" },
  { name: "registered USDT", route: "epoch-usdt", evm: "0xc04d2869665Be874881133943523723Be5782720", evmDecimals: 18,
    faucet: "0x0ead4362a745e7d1790d75ea779611", midenDecimals: 6, sendUnits: 1250000n,
    sendOutput: "0.000000000125", receiveOutput: "125", symbol: "USDT", midenSymbol: "USDT" },
  { name: "registered WBTC", route: "epoch-wbtc", evm: "0x9b2a2754a9182fD65360E23afCDf3BeFF51796E9", evmDecimals: 18,
    faucet: "0x1b22d80328f58c5171f67a85f170a3", midenDecimals: 6, sendUnits: 1250000n,
    sendOutput: "0.000000000125", receiveOutput: "125", symbol: "WBTC", midenSymbol: "WBTC" },
  { name: "another token pair", evm: "0x2222222222222222222222222222222222222222", evmDecimals: 8,
    faucet: "0x123456789012345678901234567890", midenDecimals: 2, sendUnits: 125n,
    sendOutput: "1.25", receiveOutput: "1250000", symbol: "TEST", midenSymbol: "MTEST" },
  ...[
    { network: "ethereum", chainId: 1, evm: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    { network: "base", chainId: 8453, evm: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    { network: "arbitrum", chainId: 42161, evm: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
    { network: "polygon", chainId: 137, evm: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
  ].map(chain => ({ ...chain, name: `Cedar ${chain.network}`, route: `mainnet:epoch:${chain.network}`,
    evmDecimals: 6, faucet: "0xe69e6ca6e39df1b10c1e5399399feb", midenDecimals: 6,
    sendUnits: 1250000n, sendOutput: "125", receiveOutput: "125", symbol: "USDC", midenSymbol: "USDCx" })),
])("Epoch route token inputs: $name", (expected) => {
  function route(mode: "send" | "receive"): BridgeRoute {
    const registered = defaultBridgeRoute("epoch", mode)!;
    if ("network" in expected) return findBridgeRoute(`${expected.route}:${mode}`)!;
    return expected.route ? findBridgeRoute(`${expected.route}-to-${mode === "send" ? "sepolia" : "miden"}`)! : {
      ...registered, id: "unregistered-test-pair",
      source: mode === "send" ? customMiden : customEvm,
      destination: mode === "send" ? customEvm : customMiden,
    };
  }

  it("uses the same source faucet and destination ERC20 for send quotes and execution", async () => {
    const selected = route("send");
    expect(selected.disabled).toBeFalsy();
    const preview = await quoteEpochSend({ route: selected, amount: "1.25", evmAddress: account, midenAccount });
    const result = await runEpochTransfer({
      route: selected, amount: "1.25", evmAddress: account, midenAccount,
      minReceived: preview.received,
      requestTransaction: vi.fn(), waitForTransaction: vi.fn(),
    });
    expect(getCrossChainQuote).toHaveBeenCalledTimes(2);
    for (const [, params] of vi.mocked(getCrossChainQuote).mock.calls) {
      expect(params).toMatchObject({
        midenFaucetId: expected.faucet, midenAmount: expected.sendUnits.toString(),
        destinationChainId: "chainId" in expected ? expected.chainId : 11155111, outputTokenAddress: expected.evm,
      });
    }
    expect(preview.received).toBe(expected.sendOutput);
    expect(result.outputAmount).toBe(expected.sendOutput);
    expect(result.intentNonce).toBe("42");
  });

  it("uses the same source ERC20 and destination faucet for receive quotes and execution", async () => {
    const selected = route("receive");
    expect(selected.disabled).toBeFalsy();
    const preview = await quoteEpochReceive({ route: selected, amount: "1.25", evmAddress: account, midenAccount });
    expect(getEpochReadOnlySdk).toHaveBeenCalledWith(account, selected.recovery, selected.source.network);
    expect(getEpochSdk).not.toHaveBeenCalled();
    const result = await runEpochTransfer({ route: selected, amount: "1.25", minReceived: preview.received, evmAddress: account, midenAccount });
    expect(getEVMToMidenQuote).toHaveBeenCalledTimes(2);
    for (const [, params] of vi.mocked(getEVMToMidenQuote).mock.calls) {
      expect(params).toMatchObject({
        evmTokenAddress: expected.evm, evmTokenDecimals: expected.evmDecimals, evmAmount: "1.25",
        destinationChainId: 999999999, midenFaucetId: expected.faucet,
      });
    }
    expect(preview.received).toBe(expected.receiveOutput);
    expect(result.outputAmount).toBe(expected.receiveOutput);
    expect(result.intentNonce).toBe("42");
  });
});

it.each(["0x0000000000000000000000000000000000000000", "0x1234"])("rejects an unconfigured ERC20 before execution: %s", async (address) => {
  const route = defaultBridgeRoute("epoch", "receive")!;
  await expect(runEpochTransfer({
    route: { ...route, source: { ...customEvm, address: address as `0x${string}` } },
    amount: "1.25", minReceived: "1", evmAddress: account, midenAccount,
  })).rejects.toThrow("not configured");
  expect(buildEVMToMidenIntent).not.toHaveBeenCalled();
});

it("publishes the committed Miden source before an allocator failure", async () => {
  const source = { noteId: `0x${"cd".repeat(32)}`, txHash: `0x${"ab".repeat(32)}` };
  const onSubmitted = vi.fn();
  vi.mocked(createBridgeP2IDENoteCallback).mockImplementation((deps) => async () => {
    deps.onNoteCreated!(source);
    return { success: true, noteId: source.noteId };
  });
  vi.mocked(buildCrossChainIntent).mockImplementation(async (_sdk, params) => {
    await params.createMidenP2IDENote(params.midenFaucetId, params.midenAmount, midenAccount, 100, [1n]);
    expect(onSubmitted).toHaveBeenCalledWith({ sourceTxHash: source.txHash, midenNoteId: source.noteId });
    throw new Error("Allocator unavailable");
  });
  await expect(runEpochTransfer({
    route: defaultBridgeRoute("epoch", "send")!, amount: "1.25", evmAddress: account, midenAccount,
    minReceived: "0.000000000125",
    requestTransaction: vi.fn(), waitForTransaction: vi.fn(), onSubmitted,
  })).rejects.toThrow("Allocator unavailable");
});

// Preview success must never authorize a later deposit without another live quote.
it.each(["send", "receive"] as const)("Cedar %s stops before signing if liquidity disappears after preview", async mode => {
  const route = findBridgeRoute(`mainnet:epoch:polygon:${mode}`)!;
  const input = { route, amount: "10", evmAddress: account, midenAccount };
  const preview = await (mode === "send" ? quoteEpochSend(input) : quoteEpochReceive(input));
  vi.mocked(mode === "send" ? getCrossChainQuote : getEVMToMidenQuote).mockRejectedValueOnce(new Error("No liquidity available for this transfer."));
  const requestTransaction = vi.fn();
  await expect(runEpochTransfer({ ...input, minReceived: preview.received, requestTransaction, waitForTransaction: vi.fn() })).rejects.toThrow("No liquidity");
  expect(buildCrossChainIntent).not.toHaveBeenCalled();
  expect(buildEVMToMidenIntent).not.toHaveBeenCalled();
  expect(requestTransaction).not.toHaveBeenCalled();
});
