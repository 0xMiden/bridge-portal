import type { Hex, PublicClient, TransactionReceipt } from "viem";

/** Only an unmined transaction is pending; RPC failures must remain distinguishable. */
export async function findTransactionReceipt(client: Pick<PublicClient, "getTransactionReceipt">, hash: Hex): Promise<TransactionReceipt | null> {
  try {
    return await client.getTransactionReceipt({ hash });
  } catch (error) {
    if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") return null;
    throw error;
  }
}
