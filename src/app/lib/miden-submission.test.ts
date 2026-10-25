import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EpochIntentSDK } from "@epoch-protocol/epoch-intents-sdk";
import { createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { defaultBridgeRoute } from "../../bridge/core/routes";
import { observeActivity } from "../../bridge/tracking";
import { getEpochReadOnlySdk } from "../../bridge/providers/epoch/sdk";
import { submitBridgeTransfer, type TransferSubmission } from "./bridge-submission";
import { loadStoredActivities } from "./bridge-persistence";
import { buildDiagnostics } from "./bridge-presentation";
import { activityDetailFor } from "./activity-detail-presentation";

// Keep submission, provider execution, note callbacks and persistence real.
// Replace browser-only WASM and the external wallet/Epoch boundaries.
vi.mock("../../wallets/testing/env", () => ({ isE2E: () => false }));
vi.mock("../../bridge/providers/epoch/sdk", () => ({ getEpochReadOnlySdk: vi.fn() }));
vi.mock("../../bridge/providers/epoch/chain", () => ({ getCurrentMidenBlock: async () => 12000 }));
vi.mock("../../wallets/miden/miden-transaction", () => ({ createFeeConversionSalt: () => "salt" }));
vi.mock("@miden-sdk/miden-wallet-adapter-base", () => ({
  Transaction: { createCustomTransaction: () => ({ type: "custom" }) },
}));
vi.mock("@miden-sdk/miden-sdk", () => ({
  AccountId: { fromHex: (value: string) => ({ toString: () => value, toBech32: () => value }) },
  AccountInterface: { BasicWallet: "basic-wallet" },
  NetworkId: { testnet: () => "testnet" },
  EthAddress: { fromHex: (value: string) => value },
  FungibleAsset: class {}, NoteAssets: class {}, NoteArray: class {}, NoteAttachment: class {},
  NoteType: { Public: "public" },
  Note: {
    createB2AggNote: () => ({ id: () => ({ toString: () => NOTE }) }),
    createP2IDENote: () => ({ id: () => ({ toString: () => NOTE }) }),
  },
  TransactionRequestBuilder: class {
    withFeeConversionSalt() { return this; }
    withOwnOutputNotes() { return this; }
    build() { return {}; }
  },
}));

const SPONSOR = "0x1111111111111111111111111111111111111111";
const MIDEN = "0x387149ae66116cf114eebd60bb7381";
const REQUEST = "accepted-wallet-request";
const NOTE = `0x${"cd".repeat(32)}`;
const TX = `0x${"ab".repeat(32)}`;
const output = { txHash: TX, outputNotes: [{ id: () => ({ toString: () => NOTE }) }] };
const sdk = new EpochIntentSDK({
  apiBaseUrl: "https://unused.invalid",
  walletClient: createWalletClient({ account: SPONSOR, chain: sepolia, transport: http() }),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getEpochReadOnlySdk).mockResolvedValue(sdk);
  vi.spyOn(sdk, "getIntentQuote").mockResolvedValue({ success: true, resourceLockRequired: true, transactions: [], tokenOut: "1000000000000000000" });
  vi.spyOn(sdk, "solveIntent").mockImplementation(async params => {
    const note = await params.createMidenP2IDENote!(params.midenFaucetId!, "1000000", MIDEN, 2000, [1n]);
    if (!note.success) throw new Error("Epoch collateral note failed");
    return { nonce: "42" } as Awaited<ReturnType<typeof sdk.solveIntent>>;
  });
  const storage = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe.each(["agglayer", "epoch"] as const)("%s Miden request persistence", provider => {
  function setup() {
    const route = defaultBridgeRoute(provider, "send")!;
    if (route.source.kind !== "miden") throw new Error("Expected Miden source");
    const requestTransaction = vi.fn().mockResolvedValue(REQUEST);
    const waitForTransaction = vi.fn();
    const input: TransferSubmission = {
      routeId: route.id, amount: "1", midenAccount: MIDEN, evmAddress: SPONSOR,
      insufficientBalance: false, evmBalance: "10", midenAsset: { ...route.source, amountRaw: 10000000000n },
      evmWallet: { connected: true, address: SPONSOR },
      midenWallet: { connected: true, address: MIDEN, requestTransaction, waitForTransaction },
      quote: { kind: "epoch", received: "1", validity: { kind: "time", expiresAt: Date.now() + 60000 },
        request: { routeId: route.id, recovery: route.recovery, amount: "1", midenAccount: MIDEN, evmAddress: SPONSOR } },
    };
    const effects = { openEvmWallet: vi.fn(), onError: vi.fn(), onSubmittingChange: vi.fn(), onPhaseChange: vi.fn(), onActivitiesChange: vi.fn(), navigate: vi.fn() };
    return { input, effects, requestTransaction, waitForTransaction };
  }

  it.each(["confirmation", "timeout"])("saves the acknowledgement before waiting and retains it after %s", async outcome => {
    const { input, effects, requestTransaction, waitForTransaction } = setup();
    const waiting = Promise.withResolvers<void>();
    const settlement = Promise.withResolvers<typeof output>();
    waitForTransaction.mockImplementation(() => { waiting.resolve(); return settlement.promise; });
    const submission = submitBridgeTransfer(input, effects);
    await waiting.promise;

    let receiptId: string | undefined;
    try {
      // Read from storage as a reloaded page would, while the wallet wait is unresolved.
      const stored = loadStoredActivities();
      expect(stored).toHaveLength(1);
      receiptId = stored[0].id;
      expect(stored[0]).toMatchObject({
        status: "source_finality", amount: "1", destination: SPONSOR,
        midenAccount: MIDEN, evmAddress: SPONSOR, routeId: input.routeId,
        midenWalletRequestId: REQUEST, midenNoteId: NOTE,
      });
      expect(stored[0].sourceTxHash).toBeUndefined();
      expect(stored[0].midenTxId).toBeUndefined();
      expect(activityDetailFor(stored[0]).receipt.sourceLink.available).toBe(false);
      expect(buildDiagnostics(stored[0])).toMatchObject({ transactions: { midenWalletRequestId: REQUEST, midenNoteId: NOTE } });
      const observation = await observeActivity(stored[0], new AbortController().signal);
      expect(observation?.warning).toBeUndefined();
    } finally {
      if (outcome === "timeout") settlement.reject(new Error("Wallet confirmation timed out"));
      else settlement.resolve(output);
      await submission;
    }

    const [reloaded] = loadStoredActivities();
    expect(loadStoredActivities()).toHaveLength(1);
    expect(reloaded).toMatchObject({ id: receiptId, midenWalletRequestId: REQUEST, midenNoteId: NOTE });
    expect(requestTransaction).toHaveBeenCalledOnce();
    expect(effects.navigate).toHaveBeenCalledOnce();
    if (outcome === "timeout") {
      expect(reloaded.status).toBe("source_finality");
      expect(reloaded.sourceTxHash).toBeUndefined();
      expect(effects.onError).toHaveBeenCalledWith(expect.stringContaining("do not submit again"));
      const detail = activityDetailFor(reloaded);
      expect(detail.guidance?.body).toContain("You don’t need to send it again.");
      expect(detail.guidance?.newTransfer).toBeFalsy();
    } else {
      expect(reloaded.sourceTxHash).toBe(TX);
      expect(activityDetailFor(reloaded).receipt.sourceLink.href).toContain(`/tx/${TX}`);
      expect(effects.onError).not.toHaveBeenCalled();
    }
  });

  it("does not persist a rejected wallet request", async () => {
    const { input, effects, requestTransaction, waitForTransaction } = setup();
    requestTransaction.mockRejectedValue(new Error("User rejected request"));
    await submitBridgeTransfer(input, effects);
    expect(loadStoredActivities()).toEqual([]);
    expect(waitForTransaction).not.toHaveBeenCalled();
    expect(effects.navigate).not.toHaveBeenCalled();
    expect(effects.onError).toHaveBeenCalledOnce();
  });
});
