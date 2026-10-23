import { getAbiItem, pad, toFunctionSignature, type AbiParameter, type Address } from "viem";
import { z } from "zod";
import { assertConfigNetwork } from "../../../config/bridge-config";
import { assertMidenAccountNetwork } from "../../../wallets/miden/network";
import { cctpBurnCall, type CctpBurnAuthorization, type CctpBurnIntent, cctpDepositHook } from "./cctp-burn";
import { cctpConfig, cctpSource, arcConfig } from "./config";
import {
  assertQuoteExpiry, cctpAuthorizationSchema, cctpRequestSchema, circleQuoteSchema,
  circleValidationSchema,
  type CctpQuote, type CctpQuoteValidation, type CircleValidation,
} from "./cctp-schema";
import { CircleApiError, parseCirclePayload } from "./circle-response";
import { postCircleJson } from "./circle-http.server";
import { arcRecipient, parseArcAmount } from "./deposit-terms";

function assertTransferTerms(input: CctpBurnIntent): void {
  parseArcAmount(input.amount);
  assertConfigNetwork(input.recovery, input.network);
  assertMidenAccountNetwork(input.recipient, input.recovery.environment);
  arcRecipient(input.recipient);
}

/** Only allow portal deployments and configured transfer terms across the API boundary. */
export function parseCctpQuoteRequest(value: unknown): CctpBurnIntent {
  const input = parseCirclePayload(cctpRequestSchema, value, "Invalid Circle transfer terms.");
  assertTransferTerms(input);
  return input;
}

export function parseCctpValidationRequest(value: unknown): CctpBurnAuthorization {
  const input = parseCirclePayload(cctpAuthorizationSchema, value, "Invalid Circle quote authorization.");
  assertTransferTerms(input);
  return input;
}

function circleQuoteServices(input: CctpBurnIntent) {
  const cctp = cctpConfig(input.recovery, input.network);
  return [
    { type: "PRE_FINALITY" },
    { type: "FORWARD", params: {
      destinationCaller: pad(cctp.executor),
      hookData: cctpDepositHook(input.sender, input.recipient, input.recovery),
    } },
  ];
}

/** Public Circle API: the signed claim binds forwarding to this exact hook. */
export async function requestCircleQuote(input: CctpBurnIntent): Promise<CctpQuote> {
  const arc = arcConfig(input.recovery);
  const source = cctpSource(input.network, input.recovery);
  const cctp = cctpConfig(input.recovery, input.network);
  const amount = parseArcAmount(input.amount).toString();
  const body = await postCircleJson(`${cctp.api}/v2/quote/burn/usdc/${source.domain}/${arc.circleDomain}`, {
    amount, feeToken: source.asset.address, requests: circleQuoteServices(input),
  });
  const quote = parseCirclePayload(circleQuoteSchema, body, "Circle returned an invalid quote. Please retry.");
  if (quote.burnAmount !== amount) {
    throw new CircleApiError("binding_mismatch", "Circle quoted a different transfer amount. Please retry.");
  }
  if (quote.feeToken.toLowerCase() !== source.asset.address.toLowerCase()) {
    throw new CircleApiError("binding_mismatch", "Circle quoted a different fee token. Please retry.");
  }
  assertQuoteExpiry(quote);
  return {
    ...input,
    signedQuote: quote.signedQuote,
    fee: quote.feeTotalAmount,
    issuedAt: quote.issuedAt,
    expiry: quote.expiry,
  };
}

const tupleSchema = z.record(z.string(), z.unknown());

/** Circle's JSON API represents ABI tuples as arrays and integer arguments as strings. */
function circleArgument(parameter: AbiParameter, value: unknown): unknown {
  if (parameter.type === "tuple" && "components" in parameter) {
    const tuple = tupleSchema.parse(value);
    return parameter.components.map(component => circleArgument(component, tuple[component.name ?? ""]));
  }
  return typeof value === "number" || typeof value === "bigint" ? String(value) : value;
}

function assertValidationBindings(result: CircleValidation, quote: CctpBurnAuthorization, feeToken: Address): void {
  if (result.signedQuote.toLowerCase() !== quote.signedQuote.toLowerCase()) {
    throw new CircleApiError("binding_mismatch", "Circle validated a different signed quote. Review the transfer again.");
  }
  if (result.feeToken.toLowerCase() !== feeToken.toLowerCase()) {
    throw new CircleApiError("binding_mismatch", "Circle validated a different fee token. Review the transfer again.");
  }
  if (result.feeTotalAmount !== quote.fee) {
    throw new CircleApiError("binding_mismatch", "Circle validated a different fee. Review the transfer again.");
  }
  if (result.nonce !== "0") {
    throw new CircleApiError("unsupported_nonce", "Circle returned an unsupported quote nonce. Review the transfer again.");
  }
}

function assertValidationServices(items: CircleValidation["items"]): void {
  if (!items.every(item => item.argsMatch)) {
    throw new CircleApiError("invalid_services", "Circle rejected the burn arguments. Review the transfer again.");
  }
  const services = new Set(items.map(item => item.type));
  if (!services.has("FORWARD") || !services.has("PRE_FINALITY")) {
    throw new CircleApiError("invalid_services", "Circle did not validate both required services. Review the transfer again.");
  }
}

/** Only ordinary expiry permits refresh; other rejection reasons must fail closed. */
function assertValidationOutcome(result: CircleValidation): void {
  const { expiry, failedChecks } = result;
  if (result.claimable) {
    if (expiry.expired || failedChecks.length !== 0) {
      throw new CircleApiError("inconsistent_validation", "Circle returned an inconsistent quote validation. Please retry.");
    }
    return;
  }
  if (!expiry.expired || expiry.secondsRemaining !== 0) {
    throw new CircleApiError("rejected_quote", "Circle rejected this quote. Review the transfer again.");
  }
  if (failedChecks.length !== 1 || failedChecks[0] !== "QUOTE_EXPIRED") {
    throw new CircleApiError("rejected_quote", "Circle rejected this quote. Review the transfer again.");
  }
}

/** Validate the canonical burn against Circle's source-chain tip. */
export async function requestCircleQuoteValidation(quote: CctpBurnAuthorization): Promise<CctpQuoteValidation> {
  const source = cctpSource(quote.network, quote.recovery);
  const cctp = cctpConfig(quote.recovery, quote.network);
  const call = cctpBurnCall(quote);
  const method = getAbiItem({ abi: call.abi, name: call.functionName });
  const body = await postCircleJson(`${cctp.api}/v2/quote/validate/usdc/${source.domain}`, {
    abiSignature: toFunctionSignature(method),
    args: method.inputs.map((parameter, index) => circleArgument(parameter, call.args[index])),
  });
  const result = parseCirclePayload(circleValidationSchema, body,
    "Circle returned an invalid quote validation. Review the transfer again.");
  assertValidationBindings(result, quote, source.asset.address);
  assertValidationServices(result.items);
  assertValidationOutcome(result);
  return { claimable: result.claimable, secondsRemaining: result.expiry.secondsRemaining };
}
