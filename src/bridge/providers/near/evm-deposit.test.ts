import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi, type Hex } from "viem";
import { submitBridgeTransfer, type TransferSubmission } from "../../../app/lib/bridge-submission";
import { activityPersistence, loadStoredActivities, saveActivities } from "../../../app/lib/bridge-persistence";
import { activityDetailFor } from "../../../app/lib/activity-detail-presentation";
import { ActivityStore } from "../../activity";
import { findBridgeRoute, reverseBridgeRoute } from "../../core/routes";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { nearQuoteResult } from "./quote";
import { nearMonitor } from "./tracking";
import { nearReceiveInput, signedNearQuote, nearStatus, nearTxHash, nearDestinationHash, testManagerKey } from "../../../../test/near-quotes";

const rpc = vi.hoisted(() => ({ balance: vi.fn(), read: vi.fn(), call: vi.fn(), gas: vi.fn(), block: vi.fn(), tip: vi.fn(), receipt: vi.fn(), resolve: vi.fn(), networks: [] as string[] }));
vi.mock("../../evm/transport", () => ({ evmReadTransport: (network: string) => ({ network }) }));
vi.mock("../../evm/source-transaction", () => ({ recoverSourceTransaction: rpc.resolve }));
vi.mock("viem", async original => ({ ...await original<typeof import("viem")>(),
  createPublicClient: ({ transport }: { transport: { network: string } }) => {
    rpc.networks.push(transport.network);
    return { getBalance: rpc.balance, readContract: rpc.read, call: rpc.call, estimateGas: rpc.gas,
      getBlock: rpc.block, estimateMaxPriorityFeePerGas: rpc.tip, getTransactionReceipt: rpc.receipt };
  },
}));
vi.mock("@defuse-protocol/one-click-sdk-typescript", async original => {
  const actual = await original<typeof import("@defuse-protocol/one-click-sdk-typescript")>();
  return { ...actual, verifyQuoteSignature: (response: Parameters<typeof actual.verifyQuoteSignature>[0]) => actual.verifyQuoteSignature(response, testManagerKey) };
});

const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.resetAllMocks(); rpc.networks.length = 0;
  const storage = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, callback: () => Promise<void>) => callback() } });
  vi.stubGlobal("fetch", fetcher);
  rpc.balance.mockResolvedValue(10n ** 18n); rpc.read.mockResolvedValue(10_000_000n);
  rpc.call.mockResolvedValue({ data: "0x" }); rpc.gas.mockResolvedValue(50_000n);
  rpc.block.mockResolvedValue({ baseFeePerGas: 1_000_000_000n }); rpc.tip.mockResolvedValue(100_000_000n);
  rpc.receipt.mockRejectedValue(Object.assign(new Error("Pending"), { name: "TransactionReceiptNotFoundError" }));
  rpc.resolve.mockResolvedValue({});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type WalletTx = { from: string; to: string; value: Hex; data: Hex; chainId: Hex };
function setup(kind: "native" | "erc20" = "native") {
  const bound = kind === "native" ? { ...nearReceiveInput, routeId: "mainnet:near-ethereum-eth-to-miden-eth", amount: "0.003000000000000001" } : nearReceiveInput;
  const route = findBridgeRoute(bound.routeId)!;
  const quote = signedNearQuote(bound, false, kind === "native" ? {
    amountOut: "290000", minAmountOut: "287100", amountOutFormatted: "0.0029",
  } : {});
  const wallet = { account: bound.evmAddress, chainId: "0xaa36a7", failSend: false };
  const writes: WalletTx[] = [];
  const provider: EvmProvider = { request: vi.fn() };
  vi.mocked(provider.request).mockImplementation(async ({ method, params }) => {
    if (method === "eth_accounts") return [wallet.account];
    if (method === "eth_chainId") return wallet.chainId;
    if (method === "wallet_switchEthereumChain") { wallet.chainId = (params as [{ chainId: string }])[0].chainId; return null; }
    if (method !== "eth_sendTransaction") throw new Error(`Unexpected wallet call: ${method}`);
    const saved = loadStoredActivities()[0];
    expect(saved.near?.submission).toBe("attempted");
    expect(saved.near?.quote.signature).toBe(quote.signature);
    writes.push((params as WalletTx[])[0]);
    if (wallet.failSend) throw new Error("Wallet response interrupted");
    return nearTxHash;
  });
  const input: TransferSubmission = { ...bound, environment: "mainnet", insufficientBalance: false, evmBalance: "10", midenAsset: null,
    quote: { ...nearQuoteResult(quote, route.id), request: { ...bound, recovery: route.recovery } },
    evmWallet: { connected: true, address: bound.evmAddress, provider },
    midenWallet: { connected: true, address: bound.midenAccount, requestTransaction: vi.fn() },
  };
  const effects = { openEvmWallet: vi.fn(), verifyBalanceCap: vi.fn(async () => {}), onError: vi.fn(), onSubmittingChange: vi.fn(), onPhaseChange: vi.fn(),
    activities: new ActivityStore(activityPersistence), navigate: vi.fn() };
  effects.activities.sync();
  fetcher.mockImplementation(async path => String(path).endsWith("prepare") ? Response.json(quote) : Response.json(nearStatus(quote)));
  return { input, effects, quote, route, writes, wallet };
}

it.each(["native", "erc20"] as const)("funds a %s quote once on the source chain and persists it before signing", async kind => {
  const test = setup(kind);
  fetcher.mockImplementation(async path => String(path).endsWith("prepare") ? Response.json(test.quote) : Response.json({ error: "Unavailable" }, { status: 503 }));
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).not.toHaveBeenCalled();
  expect(test.writes).toHaveLength(1);
  const tx = test.writes[0];
  expect(tx.from).toBe(nearReceiveInput.evmAddress);
  expect(tx.chainId).toBe(kind === "native" ? "0x1" : "0x2105");
  expect(rpc.networks).toEqual([kind === "native" ? "ethereum" : "base"]);
  if (kind === "native") {
    expect(tx.to).toBe("0x3333333333333333333333333333333333333333");
    expect(BigInt(tx.value)).toBe(3_000_000_000_000_001n);
    expect(tx.data).toBe("0x");
  } else {
    expect(tx.to).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(BigInt(tx.value)).toBe(0n);
    expect(decodeFunctionData({ abi: erc20Abi, data: tx.data })).toMatchObject({ functionName: "transfer", args: ["0x3333333333333333333333333333333333333333", 5_000_000n] });
  }
  expect(test.input.midenWallet.requestTransaction).not.toHaveBeenCalled();
  expect(loadStoredActivities()[0]).toMatchObject({ mode: "receive", sourceTxHash: nearTxHash,
    destination: nearReceiveInput.midenAccount, near: { submission: "accepted", notification: "pending" } });
  test.effects.activities = new ActivityStore(activityPersistence); test.effects.activities.sync();
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.writes).toHaveLength(1);
  expect(reverseBridgeRoute(test.route)?.id).toBe(kind === "native" ? "mainnet:near-miden-eth-to-ethereum-eth" : "mainnet:near-miden-usdcx-to-base-usdc");
});

it("retains an ambiguous wallet attempt across reload without funding it again", async () => {
  const test = setup(); test.wallet.failSend = true;
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).toHaveBeenCalledWith(expect.stringContaining("Wallet response interrupted"));
  expect(loadStoredActivities()[0]).toMatchObject({ near: { submission: "attempted" } });
  test.effects.activities = new ActivityStore(activityPersistence); test.effects.activities.sync();
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.writes).toHaveLength(1);
});

it.each([
  ["gas", /network fee/], ["token balance", /Not enough USDC/], ["token rejected", /token rejected/],
  ["account changed", /account or network changed/], ["chain changed", /account or network changed/],
  ["paused", /paused/], ["storage", /Storage is unavailable/], ["cap", /balance limit/],
  ["memo", /unsupported memo/], ["expired", /expired/],
] as const)("blocks %s before opening the funding prompt", async (failure, message) => {
  const test = setup("erc20");
  if (failure === "gas") rpc.balance.mockResolvedValue(0n);
  if (failure === "token balance") rpc.read.mockResolvedValue(0n);
  if (failure === "token rejected") rpc.call.mockResolvedValue({ data: `0x${"0".repeat(64)}` });
  if (failure === "account changed" || failure === "chain changed") fetcher.mockImplementation(async () => {
    if (failure === "account changed") test.wallet.account = "0x2222222222222222222222222222222222222222";
    else test.wallet.chainId = "0x1";
    return Response.json(test.quote);
  });
  if (failure === "paused") fetcher.mockResolvedValue(Response.json({ error: "Transfers paused" }, { status: 503 }));
  if (failure === "storage") vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("Quota"); });
  if (failure === "cap") test.effects.verifyBalanceCap.mockRejectedValue(new Error("Over the balance limit"));
  if (failure === "memo") test.input.quote = { ...test.input.quote!, ...nearQuoteResult(signedNearQuote(nearReceiveInput, false, { depositMemo: "required" }), test.route.id) };
  if (failure === "expired") fetcher.mockImplementation(async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(test.quote.quoteRequest.deadline) + 1);
    return Response.json(test.quote);
  });
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).toHaveBeenCalledWith(expect.stringMatching(message));
  expect(test.writes).toHaveLength(0);
});

it.each(["SUCCESS", "REFUNDED"] as const)("tracks %s with Miden output precision and source-chain refund units", async status => {
  const test = setup();
  fetcher.mockImplementation(async path => String(path).endsWith("prepare") ? Response.json(test.quote) : Response.json({ error: "Unavailable" }, { status: 503 }));
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).not.toHaveBeenCalled();
  // The first live inbound receipt predates the normalized explorer account.
  saveActivities(loadStoredActivities().map(activity => ({ ...activity, midenAccountHex: undefined })));
  test.effects.activities.sync();
  const activity = loadStoredActivities()[0];
  const statusPayload = { ...nearStatus(test.quote, status), swapDetails: {
    originChainTxHashes: [{ hash: nearTxHash }], destinationChainTxHashes: status === "SUCCESS" ? [{ hash: nearDestinationHash }] : [],
    amountOut: "290000", refundedAmount: status === "REFUNDED" ? "2900000000000000" : "0", refundReason: null,
  } };
  fetcher.mockImplementation(async path => String(path).endsWith("status") ? Response.json(statusPayload) : Response.json({ error: "Unavailable" }, { status: 503 }));
  const observation = await nearMonitor.observe(activity, new AbortController().signal);
  expect(observation.warning).toBeUndefined();
  test.effects.activities.patch(activity.id, observation.patch);
  const saved = loadStoredActivities()[0];
  expect(saved.status).toBe(status === "SUCCESS" ? "complete" : "refunded");
  expect(nearMonitor.canPoll(saved)).toBe(false);
  if (status === "SUCCESS") {
    expect(saved).toMatchObject({ receivedAmount: "0.0029", midenTxId: nearDestinationHash, destinationTxHash: nearDestinationHash });
    expect(activityDetailFor(saved).receipt.destinationLink).toMatchObject({ available: true, href: "https://explorer.cedar.miden.io/account/387149ae66116cf114eebd60bb7381" });
  } else {
    expect(saved.destinationTxHash).toBeUndefined();
    expect(activityDetailFor(saved)).toMatchObject({ receipt: { receivedAmount: "0", receivedLabel: "Miden delivery", refund: "0.0029 ETH" }, guidance: { title: "Refunded to your EVM wallet" } });
  }
});

it.each(["pending", "confirmed", "reverted", "cancelled", "repriced"])("retains a %s EVM source outcome while NEAR awaits the deposit", async state => {
  const test = setup();
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).not.toHaveBeenCalled();
  const activity = loadStoredActivities()[0];
  if (state === "confirmed" || state === "reverted") rpc.receipt.mockResolvedValue({ transactionHash: nearTxHash, status: state === "reverted" ? "reverted" : "success" });
  if (state === "cancelled" || state === "repriced") rpc.resolve.mockResolvedValue({ hash: nearDestinationHash, reason: state });
  const observed = await nearMonitor.observe(activity, new AbortController().signal);
  test.effects.activities.patch(activity.id, observed.patch);
  const saved = loadStoredActivities()[0];
  expect(saved.status).toBe(state === "reverted" || state === "cancelled" ? "failed" : "source_finality");
  expect(saved.near?.submission).toBe(state === "confirmed" ? "confirmed" : "accepted");
  expect(saved.sourceTxHash).toBe(state === "cancelled" || state === "repriced" ? nearDestinationHash : nearTxHash);
  expect(saved.destinationTxHash).toBeUndefined();
});
