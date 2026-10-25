import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EpochIntentSDK } from "@epoch-protocol/epoch-intents-sdk";
import { createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { findBridgeRoute } from "../../core/routes";
import { quoteTransfer } from "../../quotes";
import { submitBridgeTransfer, type TransferSubmission } from "../../../app/lib/bridge-submission";
import { loadStoredActivities } from "../../../app/lib/bridge-persistence";
import { getEpochReadOnlySdk, getEpochSdk } from "./sdk";

// Exercise review, submission, execution and SDK task encoding together. Only
// wallet setup, Miden WASM and the SDK's quote/signing boundaries are replaced.
vi.mock("../../../wallets/testing/env", () => ({ isE2E: () => false }));
vi.mock("./sdk", () => ({ getEpochReadOnlySdk: vi.fn(), getEpochSdk: vi.fn() }));
vi.mock("./miden-note", () => ({ createBridgeP2IDENoteCallback: vi.fn() }));
vi.mock("@miden-sdk/miden-sdk", () => ({
  AccountId: { fromHex: (value: string) => ({ toString: () => value }) },
}));

const SPONSOR = "0x1111111111111111111111111111111111111111";
const MIDEN = "0x387149ae66116cf114eebd60bb7381";
const sdk = new EpochIntentSDK({
  apiBaseUrl: "https://unused.invalid",
  walletClient: createWalletClient({ account: SPONSOR, chain: sepolia, transport: http() }),
});
const estimate = (tokenOut: string) => ({ success: true, resourceLockRequired: true, transactions: [], tokenOut });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getEpochReadOnlySdk).mockResolvedValue(sdk);
  vi.mocked(getEpochSdk).mockResolvedValue(sdk);
  vi.spyOn(sdk, "solveIntent").mockResolvedValue({ nonce: "42" } as Awaited<ReturnType<typeof sdk.solveIntent>>);
  const storage = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe.each([
  // 18 destination decimals on send, 6 on receive. The send values also catch
  // a lossy Number conversion: a one-unit change is below float precision.
  { mode: "send", routeId: "epoch-test-usdc-to-sepolia", reviewed: "918687000000000001" },
  { mode: "receive", routeId: "epoch-test-usdc-to-miden", reviewed: "918687" },
] as const)("Epoch $mode reviewed payout", ({ routeId, reviewed }) => {
  async function setup() {
    const route = findBridgeRoute(routeId)!;
    const request = { route, amount: "1", midenAccount: MIDEN, evmAddress: SPONSOR };
    const getQuote = vi.spyOn(sdk, "getIntentQuote").mockResolvedValue(estimate(reviewed));
    const quote = await quoteTransfer(request, new AbortController().signal);
    const input: TransferSubmission = {
      routeId, amount: "1", midenAccount: MIDEN, evmAddress: SPONSOR, quote: quote!,
      insufficientBalance: false, evmBalance: "10 USDC", midenAsset: null,
      evmWallet: { connected: true, address: SPONSOR, provider: { request: vi.fn().mockResolvedValue("0xaa36a7") } },
      midenWallet: { connected: true, address: MIDEN, requestTransaction: vi.fn(), waitForTransaction: vi.fn() },
    };
    const effects = { openEvmWallet: vi.fn(), onError: vi.fn(), onSubmittingChange: vi.fn(), onPhaseChange: vi.fn(), onActivitiesChange: vi.fn(), navigate: vi.fn() };
    return { input, effects, getQuote };
  }

  it("requires another review when the refreshed quote falls by one base unit", async () => {
    const { input, effects, getQuote } = await setup();
    getQuote.mockResolvedValue(estimate((BigInt(reviewed) - 1n).toString()));
    await submitBridgeTransfer(input, effects);

    expect(effects.onError).toHaveBeenCalledWith(expect.stringMatching(/quote.*review/i));
    expect(sdk.solveIntent).not.toHaveBeenCalled();
    expect(input.midenWallet.requestTransaction).not.toHaveBeenCalled();
    expect(loadStoredActivities()).toEqual([]);
    expect(effects.navigate).not.toHaveBeenCalled();
  });

  it.each([0n, 1n])("keeps the reviewed floor in the signed intent when the refreshed quote changes by %s", async difference => {
    const { input, effects, getQuote } = await setup();
    const refreshed = (BigInt(reviewed) + difference).toString();
    getQuote.mockResolvedValue(estimate(refreshed));
    await submitBridgeTransfer(input, effects);

    expect(effects.onError).not.toHaveBeenCalled();
    expect(sdk.solveIntent).toHaveBeenCalledOnce();
    expect(sdk.solveIntent).toHaveBeenCalledWith(expect.objectContaining({
      intentData: expect.objectContaining({ minTokenOut: reviewed }),
      quoteResult: expect.objectContaining({ tokenOut: refreshed }),
    }));
  });
});
