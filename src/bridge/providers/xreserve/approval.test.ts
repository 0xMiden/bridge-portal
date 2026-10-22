import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WaitForTransactionReceiptTimeoutError } from "viem";
import type { SourceTransaction } from "../../evm/source-transaction";

type Input = Parameters<typeof import("./approval").ensureUsdcApproval>[0];
const mocks = vi.hoisted(() => ({ read: vi.fn(), simulate: vi.fn(), write: vi.fn(), wait: vi.fn(), capture: vi.fn(), resolve: vi.fn() }));
vi.mock("../../evm/source-transaction", () => ({ captureSourceTransaction: mocks.capture, resolveSourceTransaction: mocks.resolve }));
const account = `0x${"11".repeat(20)}` as const;
const token = `0x${"22".repeat(20)}` as const;
const spender = `0x${"33".repeat(20)}` as const;
const hash = `0x${"aa".repeat(32)}` as const;
const replacement = `0x${"bb".repeat(32)}` as const;
const amount = 1_400_000n;
const transaction: SourceTransaction = { hash, from: account, nonce: 7, to: token, input: "0x1234", value: "0" };
let approved: bigint;
let storage: Map<string, string>;
function input(): Input {
  return {
    network: "ethereum", account, token, spender, amount,
    client: { readContract: mocks.read, simulateContract: mocks.simulate, waitForTransactionReceipt: mocks.wait } as Input["client"],
    wallet: { writeContract: mocks.write } as Input["wallet"],
    assertWallet: vi.fn().mockResolvedValue(undefined), onPhase: vi.fn(),
  };
}
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  storage = new Map();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
  approved = 0n;
  mocks.read.mockImplementation(async () => approved);
  mocks.simulate.mockImplementation(async request => ({ request }));
  mocks.write.mockResolvedValue(hash);
  mocks.wait.mockImplementation(async () => { approved = amount; return { status: "success" }; });
  mocks.capture.mockResolvedValue(transaction);
  mocks.resolve.mockResolvedValue({});
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(["timeout", "RPC outage"])("resumes the saved approval after a %s and reload instead of signing twice", async failure => {
  const { ensureUsdcApproval } = await import("./approval");
  mocks.wait.mockRejectedValueOnce(new Error(failure));
  await expect(ensureUsdcApproval(input())).rejects.toThrow(`Approval: ${hash}`);
  expect(storage.size).toBe(1);
  // A reload discards module memory; the second execution must recover storage.
  vi.resetModules();
  const resumed = await import("./approval");
  await resumed.ensureUsdcApproval(input());
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.wait).toHaveBeenNthCalledWith(2, expect.objectContaining({ hash }));
  expect(mocks.resolve).toHaveBeenCalledWith("ethereum", hash, transaction);
  expect(storage.size).toBe(0);
});

it("retains the hash in the current session when browser storage is unavailable", async () => {
  vi.stubGlobal("window", { get localStorage() { throw new Error("Storage disabled"); } });
  const { ensureUsdcApproval } = await import("./approval");
  mocks.wait.mockRejectedValueOnce(new Error("Timeout"));
  await expect(ensureUsdcApproval(input())).rejects.toThrow(hash);
  await ensureUsdcApproval(input());
  expect(mocks.write).toHaveBeenCalledOnce();
});

it.each([
  { hash: "0x1234" },
  { transaction: false },
  { replacementReason: "unknown" },
  { transaction: { ...transaction, nonce: 7.5 } },
  { transaction: { ...transaction, value: "-1" } },
  { transaction: { ...transaction, hash: "0x1234" } },
  { transaction: { ...transaction, from: "not-an-address" } },
  { transaction: { ...transaction, to: "0x1234" } },
  { transaction: { ...transaction, input: "0x123" } },
])("rejects malformed saved approval data before another wallet action: %j", async invalid => {
  const { ensureUsdcApproval } = await import("./approval");
  mocks.wait.mockRejectedValueOnce(new Error("Timeout"));
  await expect(ensureUsdcApproval(input())).rejects.toThrow(hash);
  const [key, raw] = [...storage.entries()][0];
  storage.set(key, JSON.stringify({ ...JSON.parse(raw), ...invalid }));

  vi.resetModules();
  const resumed = await import("./approval");
  await expect(resumed.ensureUsdcApproval(input())).rejects.toThrow("Saved USDC approval details are invalid");
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.wait).toHaveBeenCalledOnce();
});

it.each([true, false])("reconciles an unavailable approval after reload using on-chain allowance (sufficient: %s)", async sufficient => {
  // Exercise the real missing-transaction resolver: without a captured nonce it
  // cannot find a wallet replacement, even when that replacement has mined.
  const transactions = await vi.importActual<typeof import("../../evm/source-transaction")>("../../evm/source-transaction");
  mocks.capture.mockImplementation(transactions.captureSourceTransaction);
  mocks.resolve.mockImplementation(transactions.resolveSourceTransaction);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ result: null })));
  mocks.wait.mockRejectedValue(new WaitForTransactionReceiptTimeoutError({ hash }));
  const { ensureUsdcApproval } = await import("./approval");
  await expect(ensureUsdcApproval(input())).rejects.toThrow(hash);

  vi.resetModules();
  approved = sufficient ? amount : 0n;
  const resumed = await import("./approval");
  if (sufficient) await resumed.ensureUsdcApproval(input());
  else await expect(resumed.ensureUsdcApproval(input())).rejects.toThrow(hash);

  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.wait).toHaveBeenCalledTimes(sufficient ? 1 : 2);
  expect(storage.size).toBe(sufficient ? 0 : 1);
  if (sufficient) {
    // Once this transfer consumes its allowance, a later transfer can request
    // its own approval instead of getting stuck on the now-obsolete record.
    approved = 0n;
    mocks.wait.mockImplementation(async () => { approved = amount; return { status: "success" }; });
    await resumed.ensureUsdcApproval(input());
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(storage.size).toBe(0);
  }
});

it("skips approval when allowance already covers the requested amount", async () => {
  approved = amount;
  const { ensureUsdcApproval } = await import("./approval");
  await ensureUsdcApproval(input());
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.wait).not.toHaveBeenCalled();
});

it.each(["repriced", "cancelled", "replaced"] as const)("handles a %s approval observed while waiting", async reason => {
  const { ensureUsdcApproval } = await import("./approval");
  mocks.wait.mockImplementation(async ({ onReplaced }) => {
    onReplaced({ reason, transaction: { ...transaction, hash: replacement, value: 0n } });
    approved = amount;
    return { status: "success" };
  });
  if (reason === "repriced") await ensureUsdcApproval(input());
  else await expect(ensureUsdcApproval(input())).rejects.toThrow(reason === "cancelled" ? "cancelled" : "different transaction");
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(storage.size).toBe(0);
});

it.each(["repriced", "cancelled", "replaced"] as const)("resolves a %s approval after returning to the bridge", async reason => {
  const { ensureUsdcApproval } = await import("./approval");
  mocks.wait.mockRejectedValueOnce(new Error("Timeout"));
  await expect(ensureUsdcApproval(input())).rejects.toThrow(hash);
  mocks.resolve.mockResolvedValue({ hash: replacement, transaction, reason });
  // A known cancellation/replacement must stop this attempt even if another
  // approval currently covers it; a new explicit submission can use that allowance.
  if (reason !== "repriced") approved = amount;
  if (reason === "repriced") {
    await ensureUsdcApproval(input());
    expect(mocks.wait).toHaveBeenLastCalledWith(expect.objectContaining({ hash: replacement }));
  } else {
    await expect(ensureUsdcApproval(input())).rejects.toThrow(reason === "cancelled" ? "cancelled" : "different transaction");
    expect(mocks.wait).toHaveBeenCalledOnce();
  }
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(storage.size).toBe(0);
});

it.each(["reverted", "insufficient"])("does not silently reapprove a terminal %s approval", async state => {
  const { ensureUsdcApproval } = await import("./approval");
  mocks.wait.mockResolvedValue({ status: state === "reverted" ? "reverted" : "success" });
  await expect(ensureUsdcApproval(input())).rejects.toThrow(state);
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(storage.size).toBe(0);
});

it("keeps a repriced hash for the next attempt when polling later fails", async () => {
  const { ensureUsdcApproval } = await import("./approval");
  mocks.wait.mockImplementationOnce(async ({ onReplaced }) => {
    onReplaced({ reason: "repriced", transaction: { ...transaction, hash: replacement, value: 0n } });
    throw new Error("RPC unavailable");
  });
  await expect(ensureUsdcApproval(input())).rejects.toThrow(replacement);
  await ensureUsdcApproval(input());
  expect(mocks.wait).toHaveBeenLastCalledWith(expect.objectContaining({ hash: replacement }));
  expect(mocks.write).toHaveBeenCalledOnce();
});

it("does not send a second approval while one execution is waiting", async () => {
  const { ensureUsdcApproval } = await import("./approval");
  let confirm!: () => void;
  mocks.wait.mockImplementation(() => new Promise(resolve => { confirm = () => { approved = amount; resolve({ status: "success" }); }; }));
  const first = ensureUsdcApproval(input());
  await vi.waitFor(() => expect(mocks.wait).toHaveBeenCalledOnce());
  await expect(ensureUsdcApproval(input())).rejects.toThrow("already being checked");
  confirm();
  await first;
  expect(mocks.write).toHaveBeenCalledOnce();
});
