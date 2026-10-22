import { erc20Abi, type Address, type Hash, type PublicClient, type WalletClient } from "viem";
import type { EvmNetwork } from "../../core/assets";
import { captureSourceTransaction, resolveSourceTransaction, type SourceTransaction } from "../../evm/source-transaction";

type PendingApproval = {
  hash: Hash;
  transaction?: SourceTransaction;
  replacementReason?: "repriced" | "cancelled" | "replaced";
};
const pendingInMemory = new Map<string, PendingApproval>();
const unavailableStorage = new Set<string>();
const active = new Set<string>();

function load(key: string): PendingApproval | undefined {
  if (unavailableStorage.has(key)) return pendingInMemory.get(key);
  let raw: string | null;
  try { raw = window.localStorage.getItem(key); }
  catch { return pendingInMemory.get(key); }
  // Storage is authoritative when available, including removal in another tab.
  if (!raw) { pendingInMemory.delete(key); return undefined; }
  try {
    const value = JSON.parse(raw);
    if (!value || !/^0x[\da-f]{64}$/i.test(value.hash) ||
        (value.replacementReason !== undefined && !["repriced", "cancelled", "replaced"].includes(value.replacementReason))) throw new Error();
    const tx = value.transaction;
    if (tx && (typeof tx.hash !== "string" || typeof tx.from !== "string" ||
        !Number.isSafeInteger(tx.nonce) || tx.nonce < 0 ||
        (tx.to !== null && typeof tx.to !== "string") || typeof tx.input !== "string" ||
        typeof tx.value !== "string" || !/^\d+$/.test(tx.value))) throw new Error();
    pendingInMemory.set(key, value);
    return value;
  } catch {
    throw new Error("Saved USDC approval details are invalid. Check the approval in your wallet before trying again.");
  }
}

function save(key: string, pending: PendingApproval) {
  pendingInMemory.set(key, pending);
  try { window.localStorage.setItem(key, JSON.stringify(pending)); unavailableStorage.delete(key); }
  catch { unavailableStorage.add(key); }
}

function clear(key: string) {
  pendingInMemory.delete(key);
  try { window.localStorage.removeItem(key); unavailableStorage.delete(key); }
  catch { unavailableStorage.add(key); }
}

function replacementError(reason: PendingApproval["replacementReason"]) {
  return new Error(reason === "cancelled"
    ? "USDC approval was cancelled in your wallet. No bridge transfer was sent."
    : "USDC approval was replaced by a different transaction. Review the transfer again; no bridge transfer was sent.");
}

/** Persist approvals independently of bridge receipts: approval does not send a transfer. */
export async function ensureUsdcApproval({ network, client, wallet, account, token, spender, amount, assertWallet, onPhase }: {
  network: EvmNetwork;
  client: Pick<PublicClient, "readContract" | "simulateContract" | "waitForTransactionReceipt">;
  wallet: Pick<WalletClient, "writeContract">;
  account: Address;
  token: Address;
  spender: Address;
  amount: bigint;
  assertWallet: () => Promise<void>;
  onPhase: (phase: "approving" | "approval-confirming") => void;
}): Promise<void> {
  const key = `miden.bridge.ui.approval.${network}.${token.toLowerCase()}.${account.toLowerCase()}.${spender.toLowerCase()}`;
  if (active.has(key)) throw new Error("This USDC approval is already being checked. Wait for that request to finish.");
  active.add(key);
  try {
    let pending = load(key);
    let recoveryWarning: string | undefined;
    const allowance = () => client.readContract({ address: token, abi: erc20Abi,
      functionName: "allowance", args: [account, spender] });
    if (!pending) {
      if (await allowance() >= amount) return;
      await assertWallet();
      const approval = await client.simulateContract({ account, address: token, abi: erc20Abi,
        functionName: "approve", args: [spender, amount] });
      onPhase("approving");
      await assertWallet();
      const hash = await wallet.writeContract(approval.request);
      pending = { hash };
      save(key, pending); // Save before any receipt or metadata RPC can fail.
      onPhase("approval-confirming");
      const transaction = await captureSourceTransaction(network, hash).catch(() => undefined);
      if (transaction) { pending = { ...pending, transaction }; save(key, pending); }
    } else {
      onPhase("approval-confirming");
      if (pending.replacementReason === "cancelled" || pending.replacementReason === "replaced") {
        clear(key);
        throw replacementError(pending.replacementReason);
      }
      const resolution = await resolveSourceTransaction(network, pending.hash, pending.transaction);
      recoveryWarning = resolution.warning;
      pending = { ...pending, ...(resolution.transaction ? { transaction: resolution.transaction } : {}),
        ...(resolution.hash ? { hash: resolution.hash as Hash, replacementReason: resolution.reason } : {}) };
      save(key, pending);
      if (pending.replacementReason === "cancelled" || pending.replacementReason === "replaced") {
        clear(key);
        throw replacementError(pending.replacementReason);
      }
    }
    let receipt;
    try {
      // Circle's guide waits for mining. Use viem's documented default (180s),
      // preserving the hash on timeout so a retry resumes instead of reapproving.
      // https://viem.sh/docs/actions/public/waitForTransactionReceipt
      receipt = await client.waitForTransactionReceipt({
        hash: pending.hash,
        onReplaced: ({ reason, transaction }) => {
          pending = { hash: transaction.hash, replacementReason: reason, transaction: {
            hash: transaction.hash, from: transaction.from, nonce: transaction.nonce,
            to: transaction.to, input: transaction.input, value: transaction.value.toString(),
          } };
          save(key, pending);
        },
      });
    } catch (error) {
      if (pending.replacementReason === "cancelled" || pending.replacementReason === "replaced") {
        clear(key);
        throw replacementError(pending.replacementReason);
      }
      const recovery = recoveryWarning ? " If replaced in your wallet, keep the replacement hash for recovery." : "";
      throw new Error(`USDC approval confirmation is not verified. Retry checks the same approval; no bridge transfer was sent. Approval: ${pending.hash}.${recovery}`, { cause: error });
    }
    clear(key); // A receipt proves the original nonce reached a terminal state.
    if (pending.replacementReason === "cancelled" || pending.replacementReason === "replaced")
      throw replacementError(pending.replacementReason);
    if (receipt.status !== "success") throw new Error("USDC approval reverted. No bridge transfer was sent.");
    await assertWallet();
    if (await allowance() < amount)
      throw new Error("The confirmed USDC approval is insufficient. Review the transfer again; no bridge transfer was sent.");
  } finally {
    active.delete(key);
  }
}
