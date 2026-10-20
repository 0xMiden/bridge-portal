import type { QuoteRequest, QuoteResult } from "../../core/quote";
import { formatUnits, pad, type Address, type Hex } from "viem";
import { cctpConfig, cctpSource, isCctpNetwork, type CctpNetwork } from "./cctp-config";
import { cctpDepositHook } from "./cctp-hook";
import { arcConfig } from "./config";
import { arcRecipient, parseArcAmount } from "./deposit";

export type CctpQuoteRequest = { network: CctpNetwork; sender: Address; recipient: string; amount: string; deploymentId?: string };
export type CctpQuote = CctpQuoteRequest & { signedQuote: Hex; fee: string; expiresAt: number };

/** Public Circle API: the signed claim binds forwarding to this exact hook. */
export async function requestCircleQuote(input: CctpQuoteRequest): Promise<CctpQuote> {
  const ARC = arcConfig(input.deploymentId);
  const source = cctpSource(input.network, input.deploymentId);
  const CCTP = cctpConfig(input.deploymentId, input.network);
  const amount = parseArcAmount(input.amount).toString();
  const response = await fetch(`${CCTP.api}/v2/quote/burn/usdc/${source.domain}/${ARC.circleDomain}`, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ amount, feeToken: source.asset.address, requests: [
      { type: "PRE_FINALITY" },
      { type: "FORWARD", params: { destinationCaller: pad(CCTP.executor), hookData: cctpDepositHook(input.sender, input.recipient, input.deploymentId) } },
    ] }),
  });
  if (!response.ok) throw new Error("Circle could not quote this transfer. Please retry.");
  const quote = await response.json();
  const expiresAt = Number(quote.expiry?.expiresAt ?? quote.expiry?.blockEstimatedAt) * 1000;
  if (quote.burnAmount !== amount || quote.feeToken?.toLowerCase() !== source.asset.address.toLowerCase() ||
      !/^\d+$/.test(quote.feeTotalAmount) || !/^0x(?:[\da-f]{2})+$/i.test(quote.signedQuote) ||
      !Number.isFinite(expiresAt) || expiresAt <= Date.now())
    throw new Error("Circle returned an invalid or expired quote. Please retry.");
  return { ...input, signedQuote: quote.signedQuote, fee: quote.feeTotalAmount, expiresAt };
}

export async function fetchCctpQuote(input: CctpQuoteRequest, signal?: AbortSignal): Promise<CctpQuote> {
  const response = await fetch("/api/xreserve/quote", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Circle quote unavailable.");
  return body;
}


export async function quoteTransfer(input: QuoteRequest, signal: AbortSignal): Promise<QuoteResult> {
  const network = input.route.source.network;
  if (!isCctpNetwork(network) || !/^0x[\da-f]{40}$/i.test(input.evmAddress)) throw new Error("Enter a valid Circle deposit route and sender.");
  parseArcAmount(input.amount);
  arcRecipient(input.midenAccount);
  const quote = await fetchCctpQuote({ deploymentId: input.route.deploymentId, network: network as CctpNetwork, amount: input.amount, sender: input.evmAddress as Address, recipient: input.midenAccount }, signal);
  return { kind: "cctp", received: input.amount, fee: formatUnits(BigInt(quote.fee), 6), expiresAt: quote.expiresAt, authorization: quote };
}
