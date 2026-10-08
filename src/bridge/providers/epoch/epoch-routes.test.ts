import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultBridgeRoute, type BridgeRoute } from "../../core/routes";
import type { BridgeAsset } from "../../core/assets";
import { runEpochTransfer } from "./epoch-execute";
import { quoteEpochReceive, quoteEpochSend } from "./epoch-quote";
import { buildCrossChainIntent, buildEVMToMidenIntent, getCrossChainQuote, getEVMToMidenQuote } from "./bridge";

vi.mock("../../../wallets/testing/env", () => ({ isE2E: () => false }));
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
  { name: "registered USDC", evm: "0x2BB4FfD7E2c6D432b697554Efd77fA13bdbefd69", evmDecimals: 18,
    faucet: "0x537c15a622074e91188aa894456c52", midenDecimals: 6, sendUnits: 1250000n,
    sendOutput: "0.000000000125", receiveOutput: "125", symbol: "USDC", midenSymbol: "USDC" },
  { name: "another token pair", evm: "0x2222222222222222222222222222222222222222", evmDecimals: 8,
    faucet: "0x123456789012345678901234567890", midenDecimals: 2, sendUnits: 125n,
    sendOutput: "1.25", receiveOutput: "1250000", symbol: "TEST", midenSymbol: "MTEST" },
])("Epoch route token inputs: $name", (expected) => {
  function route(mode: "send" | "receive"): BridgeRoute {
    const registered = defaultBridgeRoute("epoch", mode)!;
    return expected.name === "registered USDC" ? registered : {
      ...registered, id: "unregistered-test-pair",
      source: mode === "send" ? customMiden : customEvm,
      destination: mode === "send" ? customEvm : customMiden,
    };
  }

  it("uses the same source faucet and destination ERC20 for send quotes and execution", async () => {
    const selected = route("send");
    const preview = await quoteEpochSend({ route: selected, amount: expected.sendUnits, destinationAddress: account, senderPublicKey: midenAccount });
    const result = await runEpochTransfer({
      route: selected, amount: "1.25", evmAddress: account, midenAccount,
      requestTransaction: vi.fn(), waitForTransaction: vi.fn(),
    });
    expect(getCrossChainQuote).toHaveBeenCalledTimes(2);
    for (const [, params] of vi.mocked(getCrossChainQuote).mock.calls) {
      expect(params).toMatchObject({
        midenFaucetId: expected.faucet, midenAmount: expected.sendUnits.toString(),
        destinationChainId: 11155111, outputTokenAddress: expected.evm,
        outputTokenDecimals: expected.evmDecimals,
      });
    }
    expect(preview).toEqual({ amount: "125000000", decimals: expected.evmDecimals, symbol: expected.symbol });
    expect(result.outputAmount).toBe(expected.sendOutput);
  });

  it("uses the same source ERC20 and destination faucet for receive quotes and execution", async () => {
    const selected = route("receive");
    const preview = await quoteEpochReceive({ route: selected, evmAmount: "1.25", evmSourceAddress: account, midenRecipientId: midenAccount });
    const result = await runEpochTransfer({ route: selected, amount: "1.25", evmAddress: account, midenAccount });
    expect(getEVMToMidenQuote).toHaveBeenCalledTimes(2);
    for (const [, params] of vi.mocked(getEVMToMidenQuote).mock.calls) {
      expect(params).toMatchObject({
        evmTokenAddress: expected.evm, evmTokenDecimals: expected.evmDecimals, evmAmount: "1.25",
        sourceChainId: 11155111, destinationChainId: 999999999, midenFaucetId: expected.faucet,
      });
    }
    expect(preview).toEqual({ amount: "125000000", decimals: expected.midenDecimals, symbol: expected.midenSymbol });
    expect(result.outputAmount).toBe(expected.receiveOutput);
  });
});

it.each(["0x0000000000000000000000000000000000000000", "0x1234"])("rejects an unconfigured ERC20 before execution: %s", async (address) => {
  const route = defaultBridgeRoute("epoch", "receive")!;
  await expect(runEpochTransfer({
    route: { ...route, source: { ...customEvm, address: address as `0x${string}` } },
    amount: "1.25", evmAddress: account, midenAccount,
  })).rejects.toThrow("not configured");
  expect(buildEVMToMidenIntent).not.toHaveBeenCalled();
});
