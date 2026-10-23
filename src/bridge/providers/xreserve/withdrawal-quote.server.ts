import { formatUnits, padHex } from "viem";
import { CircleApiError, parseCirclePayload } from "./circle-response";
import { postCircleJson } from "./circle-http.server";
import { arcConfig } from "./config";
import { arcRecipient, parseArcAmount } from "./deposit-terms";
import { assertWithdrawalAmounts, withdrawalDomain } from "./withdrawal";
import {
  circleWithdrawalQuoteSchema,
  type ValidatedWithdrawalQuoteRequest, type WithdrawalIntent, type WithdrawalQuote,
} from "./withdrawal-quote-schema";

function withdrawalTerms(input: ValidatedWithdrawalQuoteRequest) {
  const arc = arcConfig(input.recovery);
  const destination = input.recovery.document.supportedEvmChains[input.network]?.bridges.usdcx?.tokens?.USDC;
  if (!destination) throw new Error("The withdrawal destination is unavailable.");
  return {
    arc,
    amount: parseArcAmount(input.amount),
    domain: withdrawalDomain(input.network),
    recipient: padHex(input.recipient, { size: 32 }).toLowerCase(),
    token: padHex(destination.contractAddress, { size: 32 }).toLowerCase(),
    remoteDepositor: arcRecipient(input.sender).toLowerCase(),
  };
}
type WithdrawalTerms = ReturnType<typeof withdrawalTerms>;

function prepareWithdrawalRequest(terms: WithdrawalTerms) {
  return { batches: [{
    token: "USDC", remoteDomain: terms.arc.midenDomain,
    remoteDepositor: terms.remoteDepositor,
    finalDestinationDomain: terms.domain,
    finalDestinationRecipient: terms.recipient,
    valueIncludingFees: formatUnits(terms.amount, 6), useCircleForwarding: true,
    // Required by prepare even for direct payouts; the response must have no forwarding hook.
    forwardingOptions: { maxFee: "0.300000", usesFastFinality: true },
  }] };
}

function assertPayoutBindings(spec: WithdrawalIntent["spec"], terms: WithdrawalTerms) {
  if (spec.sourceDomain !== terms.arc.circleDomain || spec.destinationDomain !== terms.domain) {
    throw new CircleApiError("binding_mismatch", "Circle quoted a different withdrawal route.");
  }
  if (spec.destinationRecipient.toLowerCase() !== terms.recipient || spec.destinationToken.toLowerCase() !== terms.token) {
    throw new CircleApiError("binding_mismatch", "Circle quoted a different withdrawal recipient or token.");
  }
}

function assertMidenBindings(hook: WithdrawalIntent["spec"]["hookData"], terms: WithdrawalTerms) {
  if (hook.remoteDomain !== terms.arc.midenDomain || hook.remoteDepositor.toLowerCase() !== terms.remoteDepositor) {
    throw new CircleApiError("binding_mismatch", "Circle quoted a different Miden withdrawal account.");
  }
  if (hook.remoteToken.toLowerCase() !== arcRecipient(terms.arc.faucetId)) {
    throw new CircleApiError("binding_mismatch", "Circle quoted a different Miden withdrawal token.");
  }
  if (!/^0x0{40}$/i.test(hook.forwardingContractAddress) || hook.forwardingCalldata !== "0x") {
    throw new CircleApiError("rejected_quote", "Circle returned an unsupported withdrawal forwarding hook.");
  }
}

/** Read-only preparation; the wallet never signs or submits Circle's returned intent. */
export async function requestWithdrawalQuote(input: ValidatedWithdrawalQuoteRequest): Promise<WithdrawalQuote> {
  const terms = withdrawalTerms(input);
  const body = await postCircleJson(`${terms.arc.attestationApi}/v1/prepare-withdrawal`, prepareWithdrawalRequest(terms));
  const quote = parseCirclePayload(circleWithdrawalQuoteSchema, body, "Circle returned an invalid withdrawal quote.");
  const intent = quote.batches[0].burnIntents[0];
  assertPayoutBindings(intent.spec, terms);
  assertMidenBindings(intent.spec.hookData, terms);
  assertWithdrawalAmounts(terms.amount, intent.maxFee, intent.spec.value);
  // This is a short-lived estimate; the attester prepares its own final intent.
  return { ...input, fee: intent.maxFee, received: intent.spec.value, expiresAt: Date.now() + 60_000 };
}
