import { COMPACT_ABI, getTokenId } from "@epoch-protocol/epoch-intents-sdk";
import { decodeEventLog, decodeFunctionData, type Hex } from "viem";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";

export type EpochDepositEvidence = {
  sourceTxHash: string;
  epochDepositId: string;
  epochClaimHash: string;
};

export type EpochDepositTracking = {
  sponsor: string;
  token: string;
  amount: string;
  onSubmitted: (evidence: EpochDepositEvidence) => void;
};

type Deposit = Omit<EpochDepositEvidence, "sourceTxHash">;
const isHash = (value: unknown): value is string => typeof value === "string" && /^0x[\da-f]{64}$/i.test(value);

/** Observe the wallet boundary: the SDK omits deposit execution callbacks.
 * Preserve the hash before its receipt waits or POST /compact can fail. Never
 * treat an ERC-20 approval as a submitted bridge transfer.
 */
export function trackEpochDeposits(provider: EvmProvider, chainId: number, tracking: EpochDepositTracking & { compactAddress: string }): EvmProvider {
  const compact = tracking.compactAddress.toLowerCase();
  const bundles = new Map<string, Deposit>();
  const published = new Set<string>();
  function deposit(value: unknown): Deposit | undefined {
    if (!value || typeof value !== "object") return;
    const call = value as { to?: string; from?: string; data?: Hex; chainId?: string };
    if (call.to?.toLowerCase() !== compact || !call.data ||
        (call.from && call.from.toLowerCase() !== tracking.sponsor.toLowerCase()) ||
        (call.chainId && Number(call.chainId) !== chainId)) return;
    try {
      const decoded = decodeFunctionData({ abi: COMPACT_ABI, data: call.data });
      if (decoded.functionName !== "depositERC20AndRegister") return;
      const [token, lockTag, amount, claimHash] = decoded.args;
      if (token.toLowerCase() !== tracking.token.toLowerCase() || amount.toString() !== tracking.amount) return;
      return { epochDepositId: getTokenId(BigInt(lockTag), BigInt(token)).toString(), epochClaimHash: claimHash };
    } catch { return; }
  }
  function publish(hash: unknown, evidence: Deposit) {
    if (!isHash(hash) || published.has(hash)) return;
    published.add(hash);
    try {
      tracking.onSubmitted({ sourceTxHash: hash, ...evidence });
    } catch (error) {
      // Never turn an already-broadcast transaction into a wallet error: the
      // SDK may respond to that error by submitting its calls again.
      console.error("[EpochBridge] Could not save submitted deposit", { hash, ...evidence }, error);
    }
  }
  return {
    async request<T>(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<T> {
      const params = Array.isArray(args.params) ? args.params : [];
      const result = await provider.request<T>(args);
      if (args.method === "eth_sendTransaction" || args.method === "wallet_sendTransaction") {
        const evidence = deposit(params[0]);
        if (evidence) publish(result, evidence);
      }
      if (args.method === "wallet_sendCalls") {
        const batch = params[0] as { from?: string; chainId?: string; calls?: unknown[] } | undefined;
        if (batch?.from?.toLowerCase() === tracking.sponsor.toLowerCase() && Number(batch.chainId) === chainId) {
          const evidence = batch.calls?.map(deposit).find(Boolean);
          const id = typeof result === "string" ? result : (result as { id?: string })?.id;
          if (id && evidence) bundles.set(id, evidence);
        }
      }
      if (args.method === "wallet_getCallsStatus") {
        const evidence = bundles.get(String(params[0]));
        const receipts = (result as { receipts?: { transactionHash?: string; logs?: { address: string; data: Hex; topics: [Hex, ...Hex[]] }[] }[] })?.receipts;
        if (evidence) for (const receipt of receipts ?? []) {
          // Batch receipts may contain only an approval so far. Require this
          // intent's CompactRegistered event before accepting a receipt hash.
          const registered = receipt.logs?.some(log => {
            if (log.address.toLowerCase() !== compact) return false;
            try {
              const event = decodeEventLog({ abi: COMPACT_ABI, data: log.data, topics: log.topics });
              return event.eventName === "CompactRegistered" && event.args.claimHash === evidence.epochClaimHash;
            } catch { return false; }
          });
          if (registered) publish(receipt.transactionHash, evidence);
        }
      }
      return result;
    },
  };
}
