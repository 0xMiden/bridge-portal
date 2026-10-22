import { z } from "zod";
import type { Address } from "viem";
import type { EvmNetwork } from "../../core/assets";
import { transactionHashSchema } from "../../evm/evm-schema";
import { sourceTransactionSchema } from "../../evm/source-transaction-schema";

export type ApprovalScope = {
  network: EvmNetwork;
  account: Address;
  token: Address;
  spender: Address;
};

const pendingApprovalSchema = z.object({
  hash: transactionHashSchema,
  transaction: sourceTransactionSchema.optional(),
  replacementReason: z.enum(["repriced", "cancelled", "replaced"]).optional(),
});

export type PendingApproval = z.infer<typeof pendingApprovalSchema>;

const memory = new Map<string, PendingApproval>();
const unsaved = new Set<string>();
const invalidApprovalMessage = "Saved USDC approval details are invalid. Check the approval in your wallet before trying again.";

export function parsePendingApproval(value: unknown): PendingApproval {
  const parsed = pendingApprovalSchema.safeParse(value);
  if (!parsed.success) throw new Error(invalidApprovalMessage, { cause: parsed.error });
  return parsed.data;
}

function loadApproval(key: string): PendingApproval | undefined {
  if (unsaved.has(key)) return memory.get(key);
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return memory.get(key);
  }
  // Available storage is authoritative, including deletion in another tab.
  if (!raw) {
    memory.delete(key);
    return undefined;
  }
  try {
    const pending = parsePendingApproval(JSON.parse(raw));
    memory.set(key, pending);
    return pending;
  } catch (error) {
    throw new Error(invalidApprovalMessage, { cause: error });
  }
}

function saveApproval(key: string, pending: PendingApproval) {
  memory.set(key, pending);
  try {
    window.localStorage.setItem(key, JSON.stringify(pending));
    unsaved.delete(key);
  } catch {
    unsaved.add(key);
  }
}

function clearApproval(key: string) {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
    unsaved.delete(key);
  } catch {
    unsaved.add(key);
  }
}

/** Browser persistence for unfinished approval requirements, separate from bridge receipts. */
export function approvalStore(scope: ApprovalScope) {
  const { network, account, token, spender } = scope;
  // Preserve existing records across deployment and page reloads.
  const key = `miden.bridge.ui.approval.${network}.${token.toLowerCase()}.${account.toLowerCase()}.${spender.toLowerCase()}`;
  return {
    key,
    load: () => loadApproval(key),
    save: (pending: PendingApproval) => saveApproval(key, pending),
    clear: () => clearApproval(key),
  };
}
