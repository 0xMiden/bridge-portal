import { ApiError, OneClickService, OpenAPI, type CancelablePromise } from "@defuse-protocol/one-click-sdk-typescript";
import { nearInputSchema, nearPrepareInputSchema, nearTrackingInputSchema, nearDepositInputSchema, nearStatusResponseSchema, nearQuoteSchema, nearCorrelationId, nearEvmAddress } from "./schema";
import { bitcoinAddressSchema } from "../../bitcoin/address";
import { nearRequest, verifyNearQuote, verifySignedNearQuote, nearReceiptAssets, nearTrackingInput, nearDepositWindow, validateNearTxHash } from "./quote";
import { currentBridgeConfig } from "../../../config/bridge-config";

const API = "https://1click.chaindefuser.com";
const headers = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 32_768;
OpenAPI.BASE = API;
// Server only. Resolve the credential for each request without putting it in quotes or receipts.
OpenAPI.TOKEN = async () => process.env.NEAR_API_KEY ?? "";

// The status API's quote echo omits tracing metadata present in /quote.
// Keep the complete signed-quote contract for preparation, receipts and clients.
const upstreamStatusSchema = nearStatusResponseSchema.extend({
  quoteResponse: nearQuoteSchema.extend({ correlationId: nearCorrelationId.optional() }),
});

class NearApiError extends Error {
  constructor(message: string, readonly status: number, readonly correlationId?: string) { super(message); }
}

async function boundedJson(message: Request): Promise<unknown> {
  const reader = message.body?.getReader();
  if (!reader) throw new Error("Missing body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error("Body too large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function upstream<T>(operation: "quote" | "status" | "deposit", start: () => CancelablePromise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const pending = start();
  const cancel = () => pending.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, operation === "quote" ? 30_000 : 15_000);
  try {
    return await pending;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const id = nearCorrelationId.safeParse(error.body?.correlationId);
    if (operation === "quote" && error.status === 400 && error.body?.message === "No liquidity available") {
      throw new NearApiError("NEAR has no liquidity for this route right now. Try another provider or retry later.", 422, id.success ? id.data : undefined);
    }
    const message = error.status === 401 || error.status === 403
      ? "NEAR could not authorize this quote. Contact support with the reference."
      : error.status === 400 ? "NEAR has no available quote for this transfer. Try another amount or provider."
      : "NEAR is unavailable. Retry from this receipt; do not send another deposit.";
    throw new NearApiError(message, 502, id.success ? id.data : undefined);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}

async function quote(body: unknown, dry: boolean, signal: AbortSignal) {
  const { input, request, reviewed } = validateCaller(() => {
    const accounts = normalizeQuoteAccounts(body);
    const { quote: reviewed, ...input } = dry
      ? { ...nearInputSchema.parse(accounts), quote: undefined }
      : nearPrepareInputSchema.parse(accounts);
    const deadline = new Date(Date.now() + nearDepositWindow(input.routeId)).toISOString();
    return { input, request: nearRequest(input, dry, deadline), reviewed };
  });
  if (!dry && currentBridgeConfig("mainnet").document.features[input.mode === "send" ? "bridgeOut" : "bridgeIn"] === false) {
    throw new NearApiError("New NEAR transfers are paused. Existing receipts continue tracking.", 503);
  }
  if (reviewed) return validateCaller(() => verifySignedNearQuote(reviewed, input, false));
  const payload = await upstream("quote", () => OneClickService.getQuote(request), signal);
  try {
    const response = verifyNearQuote(payload, input, dry);
    if (response.quoteRequest.deadline !== request.deadline) throw new Error("Deadline mismatch");
    return response;
  } catch {
    const id = nearCorrelationId.safeParse((payload as { correlationId?: unknown })?.correlationId);
    throw new NearApiError("NEAR returned an invalid or expired quote. Review a fresh quote.", 502, id.success ? id.data : undefined);
  }
}

/** Accept requests from older open tabs. The strict input schema rejects multiple address fields. */
function normalizeQuoteAccounts(body: unknown) {
  if (!body || typeof body !== "object" || "externalAddress" in body) return body;
  if ("evmAddress" in body) {
    const { evmAddress, ...rest } = body;
    return { ...rest, externalAddress: nearEvmAddress.parse(evmAddress) };
  }
  if ("bitcoinAddress" in body) {
    const { bitcoinAddress, ...rest } = body;
    return { ...rest, externalAddress: bitcoinAddressSchema.parse(bitcoinAddress) };
  }
  return body;
}

function validateCaller<T>(read: () => T): T {
  try { return read(); }
  catch { throw new NearApiError("Invalid route, amount, accounts or signed NEAR quote.", 400); }
}

async function track(body: unknown, notify: boolean, signal: AbortSignal) {
  const { original, bound, assets, txHash } = validateCaller(() => {
    const input = notify ? nearDepositInputSchema.parse(body) : { ...nearTrackingInputSchema.parse(body), txHash: undefined };
    const assets = nearReceiptAssets(input.routeId, input.quote);
    const bound = nearTrackingInput(input.routeId, input.quote, assets);
    const original = verifySignedNearQuote(input.quote, bound, false, false);
    const txHash = input.txHash && validateNearTxHash(assets.source, input.txHash);
    return { original, bound, assets, txHash };
  });
  const depositAddress = original.quote.depositAddress!;
  const depositMemo = original.quote.depositMemo;
  const payload = txHash
    ? await upstream("deposit", () => OneClickService.submitDepositTx({ depositAddress,
      txHash, ...(depositMemo ? { memo: depositMemo } : {}) }), signal)
    : await upstream("status", () => OneClickService.getExecutionStatus(depositAddress, depositMemo), signal);
  try {
    const response = upstreamStatusSchema.parse(payload);
    for (const tx of response.swapDetails.originChainTxHashes) validateNearTxHash(assets.source, tx.hash);
    for (const tx of response.swapDetails.destinationChainTxHashes) validateNearTxHash(assets.destination, tx.hash);
    // /status also drops quoteWaitingTimeMs even though the original signature
    // covers it. Restore only these omitted fields from the verified receipt,
    // then verify the returned quote in full; never overwrite returned terms.
    const returned = verifySignedNearQuote({
      ...response.quoteResponse,
      correlationId: response.quoteResponse.correlationId ?? original.correlationId,
      quoteRequest: {
        ...response.quoteResponse.quoteRequest,
        quoteWaitingTimeMs: response.quoteResponse.quoteRequest.quoteWaitingTimeMs ?? original.quoteRequest.quoteWaitingTimeMs,
      },
    }, bound, false, false);
    if (returned.signature !== original.signature || returned.quote.depositAddress !== depositAddress || returned.quote.depositMemo !== depositMemo) throw new Error("Mismatched status");
    return { ...response, quoteResponse: returned };
  } catch {
    const id = nearCorrelationId.safeParse((payload as { correlationId?: unknown })?.correlationId);
    throw new NearApiError("NEAR status does not match this receipt. Keep the receipt and retry.", 502, id.success ? id.data : undefined);
  }
}

/** Narrow same-origin endpoints. Unsupported fields/directions never reach 1Click. */
export async function handleNearRequest(request: Request, operation: "quote" | "prepare" | "status" | "deposit") {
  const correlationId = crypto.randomUUID();
  try {
    const body = await boundedJson(request).catch(() => { throw new NearApiError("Invalid NEAR request.", 400); });
    const result = operation === "quote" || operation === "prepare"
      ? await quote(body, operation === "quote", request.signal)
      : await track(body, operation === "deposit", request.signal);
    return Response.json(result, { headers });
  } catch (error) {
    const known = error instanceof NearApiError ? error : undefined;
    return Response.json({ error: known?.message ?? "NEAR is unavailable. Keep this receipt and retry; do not deposit again.",
      correlationId: known?.correlationId ?? correlationId }, { status: known?.status ?? 502, headers });
  }
}
