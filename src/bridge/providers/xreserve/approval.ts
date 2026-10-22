import { erc20Abi, type PublicClient, type ReplacementReturnType, type WalletClient } from "viem";
import { captureSourceTransaction, resolveSourceTransaction } from "../../evm/source-transaction";
import { approvalStore, parsePendingApproval, type ApprovalScope, type PendingApproval } from "./approval-store";

type ApprovalStore = ReturnType<typeof approvalStore>;
type ApprovalClient = Pick<PublicClient, "readContract" | "simulateContract" | "waitForTransactionReceipt">;
type ApprovalRequest = ApprovalScope & {
  client: ApprovalClient;
  wallet: Pick<WalletClient, "writeContract">;
  amount: bigint;
  assertWallet: () => Promise<void>;
  onPhase: (phase: "approving" | "approval-confirming") => void;
};

const active = new Set<string>();

function readAllowance({ client, token, account, spender }: ApprovalRequest) {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, spender],
  });
}

function assertApprovalNotReplaced(pending: PendingApproval, store: ApprovalStore) {
  const reason = pending.replacementReason;
  if (reason !== "cancelled" && reason !== "replaced") return;
  store.clear();
  throw new Error(reason === "cancelled"
    ? "USDC approval was cancelled in your wallet. No bridge transfer was sent."
    : "USDC approval was replaced by a different transaction. Review the transfer again; no bridge transfer was sent.");
}

async function resumeApproval(request: ApprovalRequest, store: ApprovalStore) {
  const saved = store.load();
  if (!saved) return undefined;
  request.onPhase("approval-confirming");
  assertApprovalNotReplaced(saved, store);
  const resolved = await resolveSourceTransaction(request.network, saved.hash, saved.transaction);
  const pending = parsePendingApproval({
    hash: resolved.hash ?? saved.hash,
    transaction: resolved.transaction ?? saved.transaction,
    replacementReason: resolved.reason ?? saved.replacementReason,
  });
  store.save(pending);
  assertApprovalNotReplaced(pending, store);
  return pending;
}

async function signApproval(request: ApprovalRequest, store: ApprovalStore): Promise<PendingApproval> {
  const { network, client, wallet, account, token, spender, amount, assertWallet, onPhase } = request;
  const approval = await client.simulateContract({
    account,
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
  onPhase("approving");
  await assertWallet();
  const hash = await wallet.writeContract(approval.request);
  store.save({ hash }); // Save before any metadata or receipt RPC can fail.
  onPhase("approval-confirming");
  const transaction = await captureSourceTransaction(network, hash).catch(() => undefined);
  const pending = { hash, transaction };
  store.save(pending);
  return pending;
}

function replacementApproval({ reason, transaction }: ReplacementReturnType): PendingApproval {
  return {
    hash: transaction.hash,
    replacementReason: reason,
    transaction: {
      hash: transaction.hash,
      from: transaction.from,
      nonce: transaction.nonce,
      to: transaction.to,
      input: transaction.input,
      value: transaction.value.toString(),
    },
  };
}

/** Observe a receipt; timeout keeps the requirement pending and never signs again. */
async function confirmApproval(client: ApprovalClient, store: ApprovalStore, saved: PendingApproval) {
  let pending = saved;
  const result = await client.waitForTransactionReceipt({
    // Follow Circle's viem adapter: use viem's default receipt timeout (180s).
    hash: pending.hash,
    onReplaced: replacement => {
      pending = replacementApproval(replacement);
      store.save(pending);
    },
  }).then(
    receipt => ({ kind: "confirmed" as const, receipt }),
    error => ({ kind: "unconfirmed" as const, error }),
  );
  assertApprovalNotReplaced(pending, store);
  if (result.kind === "unconfirmed") {
    throw new Error(
      `USDC approval confirmation is not verified. Retry rechecks your allowance and this approval; no bridge transfer was sent. Approval: ${pending.hash}.`,
      { cause: result.error },
    );
  }
  store.clear();
  if (result.receipt.status !== "success") {
    throw new Error("USDC approval reverted. No bridge transfer was sent.");
  }
}

/** Reconcile, approve if needed, confirm, then verify the allowance used by the burn. */
export async function ensureUsdcApproval(request: ApprovalRequest): Promise<void> {
  const store = approvalStore(request);
  if (active.has(store.key)) {
    throw new Error("This USDC approval is already being checked. Wait for that request to finish.");
  }
  active.add(store.key);
  try {
    const saved = await resumeApproval(request, store);
    await request.assertWallet();
    // Current allowance can fulfill this request even if an old hash vanished.
    // Retiring that requirement does not claim that the old transaction mined.
    if (await readAllowance(request) >= request.amount) {
      store.clear();
      return;
    }
    const pending = saved ?? await signApproval(request, store);
    await confirmApproval(request.client, store, pending);
    await request.assertWallet();
    if (await readAllowance(request) < request.amount) {
      throw new Error("The confirmed USDC approval is insufficient. Review the transfer again; no bridge transfer was sent.");
    }
  } finally {
    active.delete(store.key);
  }
}
