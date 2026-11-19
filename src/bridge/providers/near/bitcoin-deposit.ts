import type { TransferSubmission } from "../../core/submission";
import { bitcoinAddressSchema } from "../../bitcoin/address";
import type { NearQuoteResponse } from "./schema";

export function prepareBitcoinDeposit(input: TransferSubmission, quote: NearQuoteResponse) {
  const wallet = input.externalWallet;
  if (wallet.family !== "bitcoin" || typeof wallet.provider?.sendTransfer !== "function") {
    throw new Error("Connect a Bitcoin wallet that supports payments.");
  }
  const provider = wallet.provider;
  const recipient = bitcoinAddressSchema.parse(quote.quote.depositAddress);
  const amount = quote.quote.amountIn;
  // Some connectors pass satoshis to the extension as a JavaScript number.
  if (BigInt(amount) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("This Bitcoin amount exceeds the wallet limit.");
  return {
    assertWallet: () => wallet.assertAccount(input.externalAddress),
    networkFee: "Paid in your Bitcoin wallet",
    prompt: "Confirm the deposit in your Bitcoin wallet…",
    send: () => provider.sendTransfer({ recipient, amount }),
  };
}
