import type { QuoteRequest, QuoteResult } from "../../core/quote";
import { formatUnits, padHex } from "viem";
import type { BridgeNetwork } from "../../core/assets";
import { bridgeRoutes } from "../../core/routes";
import { ARC } from "./config";
import { arcRecipient } from "./deposit";
import { validateWithdrawal, withdrawalDomains, withdrawalPayload } from "./withdrawal";

export type WithdrawalQuoteRequest = { network: BridgeNetwork; amount: string; sender: string; recipient: string };
export type WithdrawalQuote = WithdrawalQuoteRequest & { fee: string; received: string; expiresAt: number };

export function validateWithdrawalQuoteRequest(input: WithdrawalQuoteRequest) {
  const amount = validateWithdrawal(input.amount, input.network);
  withdrawalPayload(input.recipient, withdrawalDomains[input.network]!);
  arcRecipient(input.sender);
  return amount;
}

/** Read-only preparation, never signing or submitting Circle's returned intent. */
export async function requestWithdrawalQuote(input: WithdrawalQuoteRequest): Promise<WithdrawalQuote> {
  const amount = validateWithdrawalQuoteRequest(input);
  const remoteDepositor = arcRecipient(input.sender);
  const recipient = padHex(input.recipient as `0x${string}`, { size: 32 }).toLowerCase();
  const domain = withdrawalDomains[input.network]!;
  const response = await fetch(`${ARC.attestationApi}/v1/prepare-withdrawal`, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ batches: [{ token: "USDC", remoteDomain: ARC.midenDomain,
      remoteDepositor, finalDestinationDomain: domain, finalDestinationRecipient: recipient,
      valueIncludingFees: formatUnits(amount, 6), useCircleForwarding: true,
      // Required by prepare even for direct payouts; reject any CCTP hook below.
      forwardingOptions: { maxFee: "0.300000", usesFastFinality: true },
    }] }),
  });
  if (!response.ok) throw new Error("Circle could not estimate this withdrawal. Try again shortly.");
  const body = await response.json();
  const batch = body?.batches?.[0];
  const intent = batch?.burnIntents?.[0];
  const spec = intent?.spec;
  const hook = spec?.hookData;
  const destination = bridgeRoutes.find(route => route.provider === "xreserve" && route.mode === "send" && route.destination.network === input.network)?.destination;
  const token = destination?.kind === "erc20" ? padHex(destination.address, { size: 32 }).toLowerCase() : undefined;
  if (body?.batches?.length !== 1 || batch?.burnIntents?.length !== 1 ||
      !/^\d+$/.test(intent?.maxFee ?? "") || !/^\d+$/.test(spec?.value ?? "") ||
      spec?.version !== 1 || spec?.sourceDomain !== ARC.circleDomain || spec?.destinationDomain !== domain ||
      spec?.destinationRecipient?.toLowerCase() !== recipient || spec?.destinationToken?.toLowerCase() !== token ||
      hook?.remoteDomain !== ARC.midenDomain || hook?.remoteDepositor?.toLowerCase() !== remoteDepositor.toLowerCase() ||
      hook?.remoteToken?.toLowerCase() !== arcRecipient(ARC.faucetId).toLowerCase() ||
      !/^0x0{40}$/i.test(hook?.forwardingContractAddress ?? "") || hook?.forwardingCalldata !== "0x") {
    throw new Error("Circle returned an unsupported withdrawal quote. Please retry later.");
  }
  const fee = BigInt(intent.maxFee);
  const received = BigInt(spec.value);
  if (received <= 0n || received + fee !== amount) throw new Error("Circle's withdrawal quote does not match the amount.");
  // This is a short-lived estimate; the attester prepares its own final intent.
  return { ...input, fee: fee.toString(), received: received.toString(), expiresAt: Date.now() + 60_000 };
}

export async function fetchWithdrawalQuote(input: WithdrawalQuoteRequest, signal?: AbortSignal): Promise<WithdrawalQuote> {
  const response = await fetch("/api/xreserve/withdrawal-quote", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Withdrawal estimate unavailable.");
  return body;
}

export async function quoteTransfer(input: QuoteRequest, signal: AbortSignal): Promise<QuoteResult> {
  const request = { network: input.route.destination.network, amount: input.amount, sender: input.midenAccount, recipient: input.evmAddress };
  validateWithdrawalQuoteRequest(request);
  const quote = await fetchWithdrawalQuote(request, signal);
  return { kind: "withdrawal", received: formatUnits(BigInt(quote.received), 6), fee: formatUnits(BigInt(quote.fee), 6), expiresAt: quote.expiresAt, authorization: quote };
}
