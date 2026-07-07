import {
  CollateralType,
  type IntentTransactionStatus,
  type TransactionExecutionPhase,
} from "@epoch-protocol/epoch-intents-sdk";
import { formatUnits, parseUnits } from "viem";

import {
  buildCrossChainIntent,
  buildEVMToMidenIntent,
  getCrossChainQuote,
  getEVMToMidenQuote,
} from "./bridge";
import {
  BRIDGEABLE_EVM_OUTPUT_TOKEN_ADDRESS,
  BRIDGEABLE_EVM_OUTPUT_TOKEN_DECIMALS,
  EPOCH_DESTINATION_CHAIN_ID,
  isBridgeableEvmTokenConfigured,
} from "./bridgeable-token";
import { getCurrentMidenBlock, MIDEN_MIN_RECLAIM_BLOCKS } from "./chain";
import {
  MIDEN_DESTINATION_CHAIN_ID,
  MIDEN_NATIVE_FAUCET_ID,
  MIDEN_NATIVE_TOKEN_DECIMALS,
} from "./config";
import type { CreateMidenP2IDNote, MidenNoteDeps } from "./miden-note";
import { createBridgeP2IDNoteCallback } from "./miden-note";
import { getEpochReadOnlySdk, getEpochSdk } from "./sdk";
import type {
  CrossChainIntentParams,
  EVMToMidenIntentParams,
  IntentResult,
} from "./types";

/**
 * Epoch execute/submit orchestration — the half the quote layer didn't cover.
 *
 * IMPORTANT: this module transitively imports the eager-WASM `@miden-sdk/miden-sdk`
 * (via chain.ts / miden-note.ts / bridge.ts), so it MUST only ever be reached
 * through a client-side dynamic `import()` (BridgeExperience does this at click
 * time). Never import it statically from an SSR-rendered component.
 *
 * Two directions:
 *  - send (Miden→EVM): mint a recallable P2IDE collateral note on Miden (the
 *    user's only signature) via the connected MidenFi adapter, then have the
 *    allocator/solver fulfil USDC on Sepolia. No EVM signature.
 *  - receive (EVM→Miden): the connected Sepolia wallet signs a deposit into The
 *    Compact (handled inside the SDK's solveIntent), then the solver mints the
 *    native MIDEN output. No Miden signature.
 */

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export type EpochDirection = "send" | "receive";

export interface RunEpochTransferArgs {
  mode: EpochDirection;
  /** Human-readable input amount as typed (MIDEN for send, USDC for receive). */
  amount: string;
  /** Miden account — sender (send) or recipient (receive). bech32 or 0x hex. */
  midenAccount: string;
  /** EVM address — recipient/sponsor (send) or connected source (receive). Must be 0x. */
  evmAddress: string;
  /** Miden write primitives from the connected MidenFi adapter. REQUIRED for send. */
  requestSend?: MidenNoteDeps["requestSend"];
  waitForTransaction?: MidenNoteDeps["waitForTransaction"];
  /** Live execution phase (approve/deposit/batch) for UI progress on receive. */
  onStatus?: (phase: TransactionExecutionPhase) => void;
}

export interface EpochExecuteResult {
  direction: EpochDirection;
  /** Intent nonce for status polling (`getIntentStatus(sponsorAddress, nonce)`). */
  intentNonce?: string;
  /** Sponsor / user address the intent status is keyed on (always the EVM 0x). */
  sponsorAddress: string;
  /** User-signed source action: Miden note tx (send) or EVM deposit tx (receive). */
  sourceTxHash?: string;
  /** Committed Miden P2IDE collateral note id (send only). */
  midenNoteId?: string;
  /** Real quoted output amount (human USDC) from the Epoch API, if available. */
  outputAmount?: string;
  /** Raw intent result for debugging / detail surfaces. */
  raw: IntentResult;
}

/** Human-format the Epoch quote's output amount (tokenOut, base units). */
function epochOutputAmount(
  quote: { quoteResult?: { tokenOut?: unknown } },
  decimals: number,
): string | undefined {
  const raw = quote.quoteResult?.tokenOut;
  if (raw == null) return undefined;
  try {
    return formatUnits(BigInt(String(raw)), decimals);
  } catch {
    return undefined;
  }
}

/** Best-effort nonce extraction — the SDK's solveIntent return is untyped (`any`). */
function extractNonce(solveResult: unknown): string | undefined {
  if (!solveResult || typeof solveResult !== "object") return undefined;
  const r = solveResult as Record<string, unknown>;
  const compact = r.compact as Record<string, unknown> | undefined;
  const allocation = r.allocationResponse as
    | Record<string, unknown>
    | undefined;
  const candidate =
    r.nonce ?? r.intentNonce ?? compact?.nonce ?? allocation?.nonce;
  return typeof candidate === "string" && candidate ? candidate : undefined;
}

function assertCommonArgs(args: RunEpochTransferArgs) {
  if (!isBridgeableEvmTokenConfigured()) {
    throw new Error("The Epoch route is not configured yet.");
  }
  const amountNum = Number(args.amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new Error("Enter an amount greater than zero.");
  }
  if (!EVM_ADDRESS_RE.test(args.evmAddress.trim())) {
    throw new Error(
      args.mode === "send"
        ? "Add a valid 0x recipient address on Sepolia."
        : "Connect a Sepolia wallet before bridging.",
    );
  }
  if (!args.midenAccount.trim()) {
    throw new Error(
      args.mode === "send"
        ? "Connect your Miden wallet to send."
        : "Add the Miden account that should receive the funds.",
    );
  }
}

/** Miden→EVM: P2IDE collateral note + Epoch intent (USDC out on Sepolia). */
async function runEpochSend(
  args: RunEpochTransferArgs,
): Promise<EpochExecuteResult> {
  if (!args.requestSend || !args.waitForTransaction) {
    throw new Error("Connect your Miden wallet to sign the send.");
  }

  const evmRecipient = args.evmAddress.trim() as `0x${string}`;
  const senderAddress = args.midenAccount.trim();

  const sdk = await getEpochReadOnlySdk(evmRecipient);
  const currentBlock = await getCurrentMidenBlock();

  const params: CrossChainIntentParams = {
    midenAccountId: senderAddress,
    midenFaucetId: MIDEN_NATIVE_FAUCET_ID,
    midenAmount: parseUnits(
      args.amount,
      MIDEN_NATIVE_TOKEN_DECIMALS,
    ).toString(),
    evmRecipient,
    destinationChainId: EPOCH_DESTINATION_CHAIN_ID,
    outputTokenAddress: BRIDGEABLE_EVM_OUTPUT_TOKEN_ADDRESS,
    outputTokenDecimals: BRIDGEABLE_EVM_OUTPUT_TOKEN_DECIMALS,
    minTokenOut: "0",
    midenReclaimHeight: currentBlock + MIDEN_MIN_RECLAIM_BLOCKS,
  };

  // The note is minted inside solveIntent; capture its id/hash for the activity.
  let noteOutcome: { noteId: string; txHash: string } | undefined;
  const createMidenP2IDNote: CreateMidenP2IDNote = createBridgeP2IDNoteCallback(
    {
      requestSend: args.requestSend,
      waitForTransaction: args.waitForTransaction,
      senderAddress,
      onNoteCreated: (info) => {
        noteOutcome = info;
      },
    },
  );

  const quote = await getCrossChainQuote(sdk, params, evmRecipient);
  const result = await buildCrossChainIntent(sdk, {
    ...params,
    collateralType: CollateralType.Miden,
    midenSourceAccount: senderAddress,
    createMidenP2IDNote,
    preFetchedQuote: quote,
  });

  if (result.error) throw new Error(result.error);

  return {
    direction: "send",
    intentNonce: extractNonce(result.solveResult),
    sponsorAddress: evmRecipient,
    sourceTxHash: noteOutcome?.txHash,
    midenNoteId: noteOutcome?.noteId,
    // Send (Miden→EVM) outputs USDC on Sepolia (18-dp mock test token).
    outputAmount: epochOutputAmount(quote, BRIDGEABLE_EVM_OUTPUT_TOKEN_DECIMALS),
    raw: result,
  };
}

/** EVM→Miden: Compact deposit (user signs) + Epoch intent (native MIDEN out). */
async function runEpochReceive(
  args: RunEpochTransferArgs,
): Promise<EpochExecuteResult> {
  const evmSource = args.evmAddress.trim() as `0x${string}`;
  const midenRecipient = args.midenAccount.trim();

  const sdk = await getEpochSdk();
  if (!sdk) throw new Error("Connect a Sepolia wallet to bridge via Epoch.");

  const params: EVMToMidenIntentParams = {
    sourceChainId: EPOCH_DESTINATION_CHAIN_ID,
    destinationChainId: MIDEN_DESTINATION_CHAIN_ID,
    evmSourceAddress: evmSource,
    evmTokenAddress: BRIDGEABLE_EVM_OUTPUT_TOKEN_ADDRESS,
    evmAmount: args.amount,
    evmTokenDecimals: BRIDGEABLE_EVM_OUTPUT_TOKEN_DECIMALS,
    midenRecipientId: midenRecipient,
    midenFaucetId: MIDEN_NATIVE_FAUCET_ID,
    minTokenOut: "0",
  };

  const quote = await getEVMToMidenQuote(sdk, params, evmSource);
  const result = await buildEVMToMidenIntent(sdk, {
    ...params,
    preFetchedQuote: quote,
    onExecutionStatus: args.onStatus
      ? (status) => args.onStatus?.(status.phase)
      : undefined,
  });

  if (result.error) throw new Error(result.error);

  return {
    direction: "receive",
    intentNonce: extractNonce(result.solveResult),
    sponsorAddress: evmSource,
    sourceTxHash: result.solveResult?.depositResult?.transactionHash,
    // Receive (EVM→Miden) outputs USDC on Miden (6-dp).
    outputAmount: epochOutputAmount(quote, MIDEN_NATIVE_TOKEN_DECIMALS),
    raw: result,
  };
}

/** Execute an Epoch transfer end-to-end. Dispatches on direction. */
export async function runEpochTransfer(
  args: RunEpochTransferArgs,
): Promise<EpochExecuteResult> {
  assertCommonArgs(args);
  return args.mode === "send" ? runEpochSend(args) : runEpochReceive(args);
}

export interface PollEpochStatusOpts {
  /** EVM sponsor/user address the intent is keyed on. */
  sponsorAddress: string;
  /** Intent nonce returned by runEpochTransfer. */
  intentNonce: string;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onUpdate?: (statuses: IntentTransactionStatus[]) => void;
}

const TERMINAL_OK = /complete|success|fulfil|settled|claimed|done/i;
const TERMINAL_FAIL = /fail|error|expire|reclaim|revert|cancel/i;

/** True once any leg reports a terminal status. */
export function isTerminalStatus(statuses: IntentTransactionStatus[]): boolean {
  return statuses.some(
    (s) => TERMINAL_OK.test(s.status) || TERMINAL_FAIL.test(s.status),
  );
}

/**
 * Poll the allocator for an intent's transaction status until terminal or
 * timeout. `getIntentStatus` is a plain allocator query, so a read-only SDK
 * keyed on the sponsor is enough — no live wallet connection required. Not
 * auto-wired into the UI yet; exported for the activity-detail surface.
 */
export async function pollEpochIntentStatus(
  opts: PollEpochStatusOpts,
): Promise<IntentTransactionStatus[]> {
  if (!EVM_ADDRESS_RE.test(opts.sponsorAddress)) {
    throw new Error("pollEpochIntentStatus needs a 0x sponsor address.");
  }
  const intervalMs = opts.intervalMs ?? 5_000;
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const sdk = await getEpochReadOnlySdk(opts.sponsorAddress as `0x${string}`);

  const startedAt = performance.now();
  let last: IntentTransactionStatus[] = [];
  for (;;) {
    if (opts.signal?.aborted) return last;
    try {
      last = await sdk.getIntentStatus(opts.sponsorAddress, opts.intentNonce);
      opts.onUpdate?.(last);
      if (isTerminalStatus(last)) return last;
    } catch (err) {
      console.warn("[epoch] getIntentStatus poll failed", err);
    }
    if (performance.now() - startedAt > timeoutMs) return last;
    await new Promise<void>((resolve) => {
      const id = setTimeout(resolve, intervalMs);
      opts.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(id);
          resolve();
        },
        { once: true },
      );
    });
  }
}
