import { encodeFunctionData, erc20Abi, toHex, type Hex, type PublicClient, type ReplacementReturnType } from "viem";
import { approvalStore, parsePendingApproval, type ApprovalScope, type PendingApproval } from "../../evm/approval-store";
import { captureSourceTransaction, resolveSourceTransaction } from "../../evm/source-transaction";

type ApprovalRequest = ApprovalScope & {
  symbol: string;
  amount: bigint;
  client: Pick<PublicClient, "readContract" | "call" | "estimateGas" | "waitForTransactionReceipt">;
  send: (tx: { to: Hex; data: Hex; value: Hex; gas: Hex }) => Promise<Hex>;
  assertWallet: () => Promise<void>;
  phase: (message: string) => void;
};
type Store = ReturnType<typeof approvalStore>;
const active = new Set<string>();

function allowance({ client, token, account, spender }: ApprovalRequest) {
  return client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account, spender] });
}

function assertNotReplaced(pending: PendingApproval, store: Store) {
  if (pending.replacementReason !== "cancelled" && pending.replacementReason !== "replaced") return;
  store.clear();
  throw new Error("Token approval was cancelled or replaced. Review the transfer again; no deposit was sent.");
}

function replacementApproval(replacement: ReplacementReturnType, amount: string | undefined): PendingApproval {
  const { transaction: tx, reason } = replacement;
  return { hash: tx.hash, amount, replacementReason: reason, transaction: {
    hash: tx.hash, from: tx.from, nonce: tx.nonce, to: tx.to, input: tx.input, value: tx.value.toString(),
  } };
}

async function confirm(request: ApprovalRequest, store: Store, saved: PendingApproval) {
  let pending = saved;
  assertNotReplaced(pending, store);
  request.phase(`Waiting for ${request.symbol} approval confirmation…`);
  const receipt = await request.client.waitForTransactionReceipt({
    hash: pending.hash, timeout: 120_000,
    onReplaced: replacement => {
      pending = replacementApproval(replacement, pending.amount);
      store.save(pending);
    },
  }).catch(error => {
    assertNotReplaced(pending, store);
    throw new Error("Approval confirmation is not verified. Retry checks the pending approval; no deposit was sent.", { cause: error });
  });
  assertNotReplaced(pending, store);
  store.clear();
  if (receipt.status !== "success") throw new Error(`${request.symbol} approval failed. Review the transfer again.`);
  await request.assertWallet();
  const confirmed = await allowance(request);
  const amount = BigInt(saved.amount ?? request.amount);
  if (amount === 0n ? confirmed !== 0n : confirmed < amount)
    throw new Error(`${request.symbol} allowance was not updated. Review the transfer again.`);
}

async function resume(request: ApprovalRequest, store: Store) {
  const saved = store.load();
  if (!saved) return;
  assertNotReplaced(saved, store);
  const resolved = await resolveSourceTransaction(request.network, saved.hash, saved.transaction);
  const pending = parsePendingApproval({
    ...saved, hash: resolved.hash ?? saved.hash, transaction: resolved.transaction ?? saved.transaction,
    replacementReason: resolved.reason ?? saved.replacementReason,
  });
  store.save(pending);
  await confirm(request, store, pending);
}

async function approve(request: ApprovalRequest, store: Store, value: bigint) {
  const { client, token, account, spender, symbol } = request;
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, value] });
  const call = { account, to: token, data };
  // USDT returns no bytes; a returned false must never be accepted.
  const result = await client.call(call);
  if (result.data && result.data !== "0x" && BigInt(result.data) !== 1n)
    throw new Error(`${symbol} approval was refused by the token contract.`);
  const gas = await client.estimateGas(call);
  request.phase(value === 0n ? `Reset ${symbol} approval in your wallet…` : `Approve ${symbol} in your wallet…`);
  const hash = await request.send({ to: token, data, value: "0x0", gas: toHex(gas * 120n / 100n) });
  const pending: PendingApproval = { hash, amount: value.toString() };
  store.save(pending); // Persist before metadata or receipt RPC can fail.
  pending.transaction = await captureSourceTransaction(request.network, hash).catch(() => undefined);
  store.save(pending);
  await confirm(request, store, pending);
}

/** Reconcile unfinished approvals before choosing a zero reset or exact allowance. */
export async function ensureAgglayerApproval(request: ApprovalRequest) {
  const store = approvalStore(request);
  if (active.has(store.key)) throw new Error("This token approval is already being checked. Wait for it to finish.");
  active.add(store.key);
  try {
    await resume(request, store);
    await request.assertWallet();
    const current = await allowance(request);
    if (current >= request.amount) return;
    if (current > 0n) await approve(request, store, 0n);
    await approve(request, store, request.amount);
  } finally {
    active.delete(store.key);
  }
}
