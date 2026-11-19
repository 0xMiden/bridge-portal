import type { TransferSubmission } from "../../core/submission";
import { supportsBitcoinPayments } from "../../../wallets/bridge-wallet";
import { bitcoinAddressSchema } from "../../bitcoin/address";
import type { NearQuoteResponse } from "./schema";

export function prepareBitcoinDeposit(input: TransferSubmission, quote: NearQuoteResponse) {
  const wallet = input.externalWallet;
  if (wallet.family !== "bitcoin" || !supportsBitcoinPayments(wallet.provider)) {
    throw new Error("Connect a Bitcoin wallet that supports payments.");
  }
  const provider = wallet.provider;
  const recipient = bitcoinAddressSchema.parse(quote.quote.depositAddress);
  const amount = quote.quote.amountIn;
  // Some connectors pass satoshis to the extension as a JavaScript number.
  if (BigInt(amount) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("This Bitcoin amount exceeds the wallet limit.");
  const sender = quote.quoteRequest.refundTo;
  const assertWallet = () => wallet.assertAccount(sender);
  return {
    assertWallet,
    networkFee: "Paid in your Bitcoin wallet",
    prompt: "Confirm the deposit in your Bitcoin wallet…",
    prepareSend: async () => {
      const paymentAccount = await assertWallet();
      const payment = { recipient, amount };
      if (provider.prepareTransfer) return provider.prepareTransfer(payment, sender, paymentAccount);
      return () => provider.sendTransfer(payment);
    },
  };
}
