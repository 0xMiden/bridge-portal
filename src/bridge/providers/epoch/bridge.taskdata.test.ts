import { afterEach, describe, expect, it, vi } from "vitest";
import { EpochIntentSDK, EVM_TO_MIDEN_EXTRA_TYPESTRING, MIDEN_TO_EVM_EXTRA_TYPESTRING, TaskType } from "@epoch-protocol/epoch-intents-sdk";
import { createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { epochWalletPaidHealth } from "../../../../test/epoch-service";

vi.mock("@miden-sdk/miden-sdk", () => ({
  AccountId: { fromHex: (value: string) => ({ toString: () => value }) },
}));
vi.mock("viem", async original => ({
  ...await original<typeof import("viem")>(),
  createPublicClient: () => ({ readContract: async () => [0, 0n] }),
}));

import { EPOCH_MIDEN_USDC } from "../../core/assets";
import { buildCrossChainIntent, buildEpochTaskDataParams, buildEVMToMidenTaskDataParams, getCrossChainQuote, getEVMToMidenQuote } from "./bridge";

const SPONSOR = "0x1111111111111111111111111111111111111111";
const ACCOUNT = "0x387149ae66116cf114eebd60bb7381";
const TOKEN = "0x2BB4FfD7E2c6D432b697554Efd77fA13bdbefd69";
const sdk = new EpochIntentSDK({
  apiBaseUrl: "https://unused.invalid",
  walletClient: createWalletClient({ account: SPONSOR, chain: sepolia, transport: http() }),
});
const midenSdk = new EpochIntentSDK({
  apiBaseUrl: "https://unused.invalid",
  walletClient: createWalletClient({ account: SPONSOR, chain: { ...sepolia, id: 999999999 }, transport: http() }),
  allowGaslessSmartAccount: false,
});
const polygonWithdrawal = {
  midenAccountId: ACCOUNT, midenFaucetId: "0xe69e6ca6e39df1b10c1e5399399feb",
  midenAmount: "10000", evmRecipient: SPONSOR, destinationChainId: 137,
  outputTokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", minTokenOut: "9900",
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Epoch SDK task data compatibility", () => {
  it("builds a Miden send accepted by the real SDK using its canonical witness", async () => {
    const params = buildEpochTaskDataParams({
      midenAccountId: ACCOUNT, midenFaucetId: EPOCH_MIDEN_USDC.faucetId,
      midenAmount: "1000000", evmRecipient: SPONSOR,
      destinationChainId: 11155111, outputTokenAddress: TOKEN, minTokenOut: "0",
    });
    expect(params.taskType).toBe(TaskType.GetTokenOut);
    expect(params.extraDataTypestring).toBe(MIDEN_TO_EVM_EXTRA_TYPESTRING);
    const task = await sdk.getTaskData(params);
    expect(task.intentData).toMatchObject({ tokenInAmount: "1000000", midenNoteType: "P2IDE", midenNoteId: "" });
    expect(task.intentData).not.toHaveProperty("midenReclaimHeight");
  });

  it("builds a Sepolia receive with the current USDC faucet and atomic input amount", async () => {
    const params = buildEVMToMidenTaskDataParams({
      destinationChainId: 999999999,
      evmSourceAddress: SPONSOR, evmTokenAddress: TOKEN, evmAmount: "1.25",
      evmTokenDecimals: 18, midenRecipientId: ACCOUNT,
      midenFaucetId: EPOCH_MIDEN_USDC.faucetId, minTokenOut: "0",
    });
    expect(params.extraDataTypestring).toBe(EVM_TO_MIDEN_EXTRA_TYPESTRING);
    const task = await sdk.getTaskData(params);
    expect(task.intentData).toMatchObject({
      tokenInAmount: "1250000000000000000", destinationChainId: "999999999",
      midenRecipientAccount: ACCOUNT, midenFaucetId: "0x5b043dcb48d5721106f7a1ceb2b804",
    });
    expect(task.intentData).not.toHaveProperty("midenSourceAccount");
  });

  it("uses the service's Miden arbiter for both the Polygon withdrawal quote and allocation", async () => {
    // Deliberately differ from SDK constants and the destination-chain arbiter.
    const arbiter = "0x3333333333333333333333333333333333333333";
    const health = epochWalletPaidHealth();
    health.arbiterAddresses![999999999] = arbiter;
    health.midenRecallBufferBlocks = 1200;
    const requests: { endpoint: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const endpoint = new URL(url).pathname;
      if (endpoint === "/health") return Response.json(health);
      if (endpoint.startsWith("/suggested-nonce/")) return Response.json({ nonce: "0x42" });
      if (endpoint === "/miden-recipient") return Response.json({ midenP2IDRecipientAccountId: ACCOUNT, midenMinReclaimBlocks: 2500 });
      if (endpoint === "/checkIfDepositNeeded" || endpoint === "/compact") {
        requests.push({ endpoint, body: JSON.parse(String(init?.body)) });
        return Response.json(endpoint === "/compact" ? { success: true } : {
          resourceLockRequired: true, tokenIn: "10000", tokenOut: "9900", transactions: [],
        });
      }
      throw new Error(`Unexpected Epoch request: ${url}`);
    }));
    const params = polygonWithdrawal;
    const preFetchedQuote = await getCrossChainQuote(midenSdk, params, SPONSOR);
    const noteId = `0x${"ab".repeat(32)}`;
    const createMidenP2IDENote = vi.fn(async () => ({ success: true, noteId }));
    vi.useFakeTimers(); // Skip the real SDK's collateral finalization delay.
    const pending = buildCrossChainIntent(midenSdk, { ...params, preFetchedQuote, createMidenP2IDENote });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.error).toBeUndefined();
    expect(result.solveResult?.nonce).toBe("66");
    expect(requests.map(request => request.endpoint)).toEqual(["/checkIfDepositNeeded", "/compact"]);
    for (const { body } of requests) expect(body).toMatchObject({
      chainId: "999999999",
      compact: { arbiter, mandate: { destinationChainId: "137", tokenInAmount: "10000" } },
    });
    expect(requests[1].body).toMatchObject({ compact: { mandate: { midenNoteId: noteId } } });
    expect(createMidenP2IDENote).toHaveBeenCalledExactlyOnceWith(params.midenFaucetId, "10000", ACCOUNT, 3700, expect.any(Array));
  });

  it.each([
    { field: "arbiterAddresses", value: undefined, error: "no arbiter address" },
    { field: "compactExpirySeconds", value: -1, error: "invalid compactExpirySeconds" },
    { field: "status", value: "unhealthy", error: "API service is unhealthy" },
  ])("still rejects invalid bridge configuration: $field", async ({ field, value, error }) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...epochWalletPaidHealth(), [field]: value })));
    await expect(getCrossChainQuote(midenSdk, polygonWithdrawal, SPONSOR)).rejects.toThrow(error);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://unused.invalid/health", expect.any(Object));
  });

  it.each([true, undefined])("requires full gasless metadata unless explicitly disabled: %s", async allowGaslessSmartAccount => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(epochWalletPaidHealth())));
    const gaslessSdk = new EpochIntentSDK({
      apiBaseUrl: "https://unused.invalid", allowGaslessSmartAccount,
      walletClient: createWalletClient({ account: SPONSOR, chain: sepolia, transport: http() }),
    });
    await expect(gaslessSdk.getHealthCheck()).rejects.toThrow("incomplete gasless configuration");
  });
});

// The SDK can report success without an output. Both preview and execution use
// these quote functions, so reject unusable estimates before collateral signing.
describe.each(["send", "receive"] as const)("Epoch %s estimate admission", (mode) => {
  const quote = () => mode === "send"
    ? getCrossChainQuote(sdk, {
        midenAccountId: ACCOUNT, midenFaucetId: EPOCH_MIDEN_USDC.faucetId,
        midenAmount: "1000000", evmRecipient: SPONSOR, destinationChainId: 11155111,
        outputTokenAddress: TOKEN, minTokenOut: "0",
      }, SPONSOR)
    : getEVMToMidenQuote(sdk, {
        destinationChainId: 999999999, evmSourceAddress: SPONSOR,
        evmTokenAddress: TOKEN, evmAmount: "1", evmTokenDecimals: 18,
        midenRecipientId: ACCOUNT, midenFaucetId: EPOCH_MIDEN_USDC.faucetId, minTokenOut: "0",
      }, SPONSOR);

  it.each([undefined, "0", "-1", "NaN", "1.5"])("rejects an unusable output: %s", async (tokenOut) => {
    vi.spyOn(sdk, "getIntentQuote").mockResolvedValue({ success: true, resourceLockRequired: false, transactions: [], tokenOut });
    await expect(quote()).rejects.toThrow("No liquidity available for this transfer.");
  });

  it("accepts a positive atomic-unit estimate", async () => {
    vi.spyOn(sdk, "getIntentQuote").mockResolvedValue({ success: true, resourceLockRequired: false, transactions: [], tokenOut: "991878" });
    expect((await quote()).quoteResult.tokenOut).toBe("991878");
  });
});
