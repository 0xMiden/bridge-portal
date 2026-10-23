import { assertConfigNetwork, configKey } from "../../../config/bridge-config";
import { formatUnits } from "viem";
import { assertMidenAccountNetwork } from "../../../wallets/miden/network";
import type { QuoteRequest, QuoteResult } from "../../core/quote";
import { normalizeMidenAccountHex } from "../agglayer/agglayer";
import { CircleApiError, circleApiError, parseCirclePayload } from "./circle-response";
import { arcRecipient, parseArcAmount } from "./deposit-terms";
import { assertWithdrawalAmounts, validateWithdrawal, withdrawalDomain, withdrawalPayload } from "./withdrawal";
import {
  withdrawalQuoteRequestSchema, withdrawalQuoteSchema,
  type WithdrawalQuote, type WithdrawalQuoteRequest, type ValidatedWithdrawalQuoteRequest,
} from "./withdrawal-quote-schema";

export type { WithdrawalQuote, WithdrawalQuoteRequest } from "./withdrawal-quote-schema";

export function parseWithdrawalQuoteRequest(value: unknown): ValidatedWithdrawalQuoteRequest {
  const request = parseCirclePayload(withdrawalQuoteRequestSchema, value, "Invalid withdrawal terms.");
  assertConfigNetwork(request.recovery, request.network);
  validateWithdrawal(request.amount, request.network);
  withdrawalPayload(request.recipient, withdrawalDomain(request.network));
  assertMidenAccountNetwork(request.sender, request.recovery.environment);
  arcRecipient(request.sender);
  return request;
}

function assertQuoteBindings(quote: WithdrawalQuote, request: ValidatedWithdrawalQuoteRequest) {
  if (quote.network !== request.network || configKey(quote.recovery) !== configKey(request.recovery)) {
    throw new CircleApiError("binding_mismatch", "The withdrawal route changed. Review the estimate again.");
  }
  if (normalizeMidenAccountHex(quote.sender) !== normalizeMidenAccountHex(request.sender) ||
      quote.recipient.toLowerCase() !== request.recipient.toLowerCase()) {
    throw new CircleApiError("binding_mismatch", "The withdrawal accounts changed. Review the estimate again.");
  }
  if (parseArcAmount(quote.amount) !== parseArcAmount(request.amount)) {
    throw new CircleApiError("binding_mismatch", "The withdrawal amount changed. Review the estimate again.");
  }
}

export async function fetchWithdrawalQuote(input: WithdrawalQuoteRequest, signal?: AbortSignal): Promise<WithdrawalQuote> {
  const request = parseWithdrawalQuoteRequest(input);
  const response = await fetch("/api/xreserve/withdrawal-quote", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal,
  });
  const body: unknown = await response.json();
  if (!response.ok) throw circleApiError(body, "Withdrawal estimate unavailable.");
  const quote = parseCirclePayload(withdrawalQuoteSchema, body, "Circle returned an invalid withdrawal estimate.");
  assertQuoteBindings(quote, request);
  assertWithdrawalAmounts(parseArcAmount(request.amount), quote.fee, quote.received);
  if (quote.expiresAt <= Date.now()) throw new Error("The withdrawal estimate expired. Please review it again.");
  return quote;
}

export async function quoteTransfer(input: QuoteRequest, signal: AbortSignal): Promise<QuoteResult> {
  const quote = await fetchWithdrawalQuote({
    recovery: input.route.recovery,
    network: input.route.destination.network,
    amount: input.amount,
    sender: input.midenAccount,
    recipient: input.evmAddress,
  }, signal);
  return {
    kind: "withdrawal", received: formatUnits(BigInt(quote.received), 6), fee: formatUnits(BigInt(quote.fee), 6),
    validity: { kind: "time", expiresAt: quote.expiresAt }, authorization: quote,
  };
}
