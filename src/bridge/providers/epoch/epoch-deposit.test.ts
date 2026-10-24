import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { COMPACT_ABI, COMPACT_ADDRESS } from "@epoch-protocol/epoch-intents-sdk";
import { createWalletClient, custom, decodeFunctionData, encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { arbitrum } from "viem/chains";
import { getWalletClient } from "@wagmi/core";
import { findBridgeRoute } from "../../core/routes";
import { submitBridgeTransfer, type TransferSubmission } from "../../../app/lib/bridge-submission";
import { loadStoredActivities, patchStoredActivity, saveActivities } from "../../../app/lib/bridge-persistence";
import { observeActivity } from "../../tracking";
import { activityState } from "../../activity";
import { createActivity, buildDiagnostics } from "../../../app/lib/bridge-presentation";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";

// Keep the SDK, wallet client, execution, submission and persistence real. Only
// the external wallet/RPC/HTTP and unrelated Miden WASM boundary are simulated.
vi.mock("@wagmi/core", () => ({ getAccount: () => ({ address: SPONSOR, chainId: 42161 }), getWalletClient: vi.fn() }));
vi.mock("../../../wallets/evm/appkit-config", () => ({ wagmiAdapter: { wagmiConfig: {} } }));
vi.mock("../../../wallets/testing/env", () => ({ isE2E: () => false }));
vi.mock("./miden-note", () => ({ createBridgeP2IDENoteCallback: vi.fn() }));
vi.mock("@miden-sdk/miden-sdk", () => ({
  AccountId: {
    fromHex: (value: string) => ({ toString: () => value }),
    fromBech32: () => ({ toString: () => "0x387149ae66116cf114eebd60bb7381" }),
  },
}));
const { rpc } = vi.hoisted(() => ({ rpc: {
  readContract: vi.fn(), getCode: vi.fn(), waitForTransactionReceipt: vi.fn(), getTransactionReceipt: vi.fn(),
} }));
vi.mock("viem", async original => ({ ...await original<typeof import("viem")>(), createPublicClient: () => rpc }));

const SPONSOR = "0x1111111111111111111111111111111111111111";
const MIDEN = "mm1recipient";
const TX = `0x${"ab".repeat(32)}` as Hex;
const APPROVAL = `0x${"cd".repeat(32)}` as Hex;
const route = findBridgeRoute("mainnet:epoch:arbitrum:receive")!;
const depositId = BigInt("0x403e97d00e2e2b0719034769af88d065e77c8cc2239327c5edb3a432268e5831").toString();

beforeEach(() => {
  vi.resetAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  rpc.readContract.mockImplementation(async ({ functionName }) => functionName === "getForcedWithdrawalStatus" ? [0, 0n] : 0n);
  rpc.getCode.mockResolvedValue("0x");
  rpc.waitForTransactionReceipt.mockResolvedValue({ status: "success", transactionHash: TX });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup(mode: "sequential" | "batch" | "rejected") {
  let claimHash: Hex;
  let typehash: Hex;
  const sent: string[] = [];
  const beforeConfirmation: { hash: Hex; recorded: string[] }[] = [];
  let beforeAllocation: ReturnType<typeof loadStoredActivities> = [];
  function readDeposit(data: Hex) {
    const call = decodeFunctionData({ abi: COMPACT_ABI, data });
    if (call.functionName !== "depositERC20AndRegister") throw new Error("Expected a Compact deposit");
    [, , , claimHash, typehash] = call.args;
  }
  const wallet = {
    request: vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
      const values = params as [{ to: string; data: Hex; calls: { to: string; data: Hex }[] }];
      if (method === "eth_chainId") return "0xa4b1";
      if (method === "eth_accounts") return [SPONSOR];
      if (method === "wallet_getCapabilities") return { "0xa4b1": { atomic: { status: mode === "batch" ? "supported" : "unsupported" } } };
      if (method === "eth_sendTransaction") {
        if (values[0].to.toLowerCase() !== COMPACT_ADDRESS[42161].toLowerCase()) {
          sent.push("approval");
          return APPROVAL;
        }
        if (mode === "rejected") throw { code: 4001, message: "User rejected request" };
        readDeposit(values[0].data);
        sent.push("deposit");
        return TX;
      }
      if (method === "eth_getTransactionReceipt") {
        const hash = (params as Hex[])[0];
        // Before confirmation, the deposit is durable; the approval isn't an activity.
        beforeConfirmation.push({ hash, recorded: loadStoredActivities().map(activity => activity.sourceTxHash!) });
        return { transactionHash: hash, status: "0x1", blockNumber: "0x10", logs: [] };
      }
      if (method === "wallet_sendCalls") {
        expect(loadStoredActivities()).toEqual([]);
        readDeposit(values[0].calls[1].data);
        sent.push("batch");
        return { id: "bundle-1" };
      }
      if (method === "wallet_getCallsStatus") return {
        id: "bundle-1", chainId: "0xa4b1", version: "2.0.0", status: 200,
        receipts: [{ transactionHash: TX, status: "0x1", blockNumber: "0x10", gasUsed: "0x10000", logs: [{
          address: COMPACT_ADDRESS[42161],
          topics: encodeEventTopics({ abi: COMPACT_ABI, eventName: "CompactRegistered", args: { sponsor: SPONSOR } }),
          data: encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [claimHash, typehash]),
        }] }],
      };
      throw new Error(`Unexpected wallet method ${method}`);
    }),
  };
  const client = createWalletClient({ account: SPONSOR, chain: arbitrum, transport: custom(wallet, { retryCount: 0 }) });
  vi.mocked(getWalletClient).mockResolvedValue(client as Awaited<ReturnType<typeof getWalletClient>>);
  const allocation = vi.fn(() => {
    beforeAllocation = loadStoredActivities();
    return Response.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/suggested-nonce/")) return Response.json({ nonce: "0x42" });
    if (url.endsWith("/checkIfDepositNeeded")) return Response.json({ resourceLockRequired: true, tokenIn: "1000000", tokenOut: "918687", transactions: [] });
    if (url.endsWith("/compact")) return allocation();
    throw new Error(`Unexpected HTTP request ${url}`);
  }));
  const input: TransferSubmission = {
    routeId: route.id, environment: "mainnet", amount: "1", insufficientBalance: false, evmBalance: "10 USDC",
    evmAddress: SPONSOR, midenAccount: MIDEN, midenAsset: null,
    evmWallet: { connected: true, address: SPONSOR, provider: wallet as EvmProvider },
    midenWallet: { connected: true, address: MIDEN },
    quote: { kind: "epoch", received: "0.918687", validity: { kind: "time", expiresAt: Date.now() + 60000 },
      request: { routeId: route.id, recovery: route.recovery, amount: "1", evmAddress: SPONSOR, midenAccount: MIDEN } },
  };
  const effects = { openEvmWallet: vi.fn(), onError: vi.fn(), onSubmittingChange: vi.fn(), onPhaseChange: vi.fn(), onActivitiesChange: vi.fn(), navigate: vi.fn() };
  return { input, effects, allocation, sent, beforeConfirmation, allocationEvidence: () => ({ activities: beforeAllocation, claimHash }) };
}

it.each(["sequential", "batch"] as const)("retains the real SDK's %s deposit across POST /compact HTTP 500 and reload", async mode => {
  const { input, effects, allocation, sent, beforeConfirmation, allocationEvidence } = setup(mode);
  await submitBridgeTransfer(input, effects);
  expect(allocation).toHaveBeenCalledOnce();
  expect(sent).toEqual(mode === "batch" ? ["batch"] : ["approval", "deposit"]);
  if (mode === "sequential") expect(beforeConfirmation).toEqual([
    { hash: APPROVAL, recorded: [] }, { hash: TX, recorded: [TX] },
  ]);
  const evidence = allocationEvidence();
  expect(evidence.activities).toMatchObject([{
    amount: "1", sourceTxHash: TX, epochDepositId: depositId, epochClaimHash: evidence.claimHash,
    status: "source_finality", epochSponsor: SPONSOR,
  }]);
  const [stored] = loadStoredActivities();
  expect(stored).toMatchObject({ sourceTxHash: TX, epochDepositId: depositId, epochError: "Internal server error · HTTP 500 · INTERNAL_ERROR" });
  expect(stored.epochIntentNonce).toBeUndefined();
  expect(effects.navigate).toHaveBeenCalledOnce();
  expect(effects.onError).toHaveBeenCalledWith(expect.stringContaining("do not submit again"));
  rpc.getTransactionReceipt.mockResolvedValue({ status: "success" });
  const observation = await observeActivity(stored, new AbortController().signal);
  patchStoredActivity(stored.id, observation!.patch);
  const [reloaded] = loadStoredActivities();
  expect(reloaded).toMatchObject({ epochDepositConfirmed: true, status: "source_finality", epochError: stored.epochError });
  expect(activityState(reloaded).headline).toBe("Deposit confirmed; delivery unconfirmed");
  expect(buildDiagnostics(reloaded)).toMatchObject({ transactions: {
    epochClaimHash: stored.epochClaimHash, epochDepositId: depositId, epochError: stored.epochError,
  } });
});

it("does not save an approval as a transfer when the deposit is rejected", async () => {
  const { input, effects, allocation, sent } = setup("rejected");
  await submitBridgeTransfer(input, effects);
  expect(sent).toEqual(["approval"]);
  expect(allocation).not.toHaveBeenCalled();
  expect(loadStoredActivities()).toEqual([]);
  expect(effects.navigate).not.toHaveBeenCalled();
  expect(effects.onError).toHaveBeenCalledWith("You cancelled the request in your wallet.");
});

it.each(["pending", "reverted", "rpc-error"] as const)("tracks an interrupted deposit with a %s source receipt", async state => {
  const activity = createActivity(route, "1", { sourceTxHash: TX, epochSponsor: SPONSOR, status: "source_finality" });
  saveActivities([activity]);
  if (state === "pending") rpc.getTransactionReceipt.mockRejectedValue(Object.assign(new Error("Not found"), { name: "TransactionReceiptNotFoundError" }));
  if (state === "reverted") rpc.getTransactionReceipt.mockResolvedValue({ status: "reverted" });
  if (state === "rpc-error") rpc.getTransactionReceipt.mockRejectedValue(new Error("RPC unavailable"));
  const result = observeActivity(activity, new AbortController().signal);
  if (state === "rpc-error") await expect(result).rejects.toThrow("RPC unavailable");
  else expect((await result)?.patch).toEqual(state === "pending" ? {} : { status: "failed", failureLeg: "source", eta: "Deposit reverted" });
});
