import type { BridgeRoute } from "../../core/routes";
import {
  type TransactionExecutionStatus,
} from "@epoch-protocol/epoch-intents-sdk";
import { formatUnits, parseUnits } from "viem";
import type { FlowMode } from "../../core/models";
import { isValidAmount } from "../../core/rules";

import {
  buildCrossChainIntent,
  buildEVMToMidenIntent,
  getCrossChainQuote,
  getEVMToMidenQuote,
} from "./bridge";
import {
  EPOCH_DESTINATION_CHAIN_ID,
  epochRouteAssets,
} from "./bridgeable-token";
import { MIDEN_DESTINATION_CHAIN_ID } from "./config";
import type { CreateMidenP2IDENote, MidenNoteDeps } from "./miden-note";
import { createBridgeP2IDENoteCallback } from "./miden-note";
import { getEpochReadOnlySdk, getEpochSdk } from "./sdk";
import type {
  CrossChainIntentParams,
  EVMToMidenIntentParams,
  IntentResult,
} from "./types";
import { e2eNetwork, isE2E } from "../../../wallets/testing/env";

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
 *    allocator/solver fulfil the destination token on Sepolia. No EVM signature.
 *  - receive (EVM→Miden): the connected Sepolia wallet signs a deposit into The
 *    Compact (handled inside the SDK's solveIntent), then the solver mints the
 *    Miden output token. No Miden signature.
 */

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface RunEpochTransferArgs {
  route: BridgeRoute;
  /** Human-readable amount in the route's source token. */
  amount: string;
  /** Miden account — sender (send) or recipient (receive). bech32 or 0x hex. */
  midenAccount: string;
  /** EVM address — recipient/sponsor (send) or connected source (receive). Must be 0x. */
  evmAddress: string;
  /** Miden write primitives from the connected MidenFi adapter. REQUIRED for send. */
  requestTransaction?: MidenNoteDeps["requestTransaction"];
  waitForTransaction?: MidenNoteDeps["waitForTransaction"];
  /** Publish the source evidence immediately, before awaiting the solver. */
  onSubmitted?: (source: { sourceTxHash: string; midenNoteId?: string }) => void;
  /**
   * Live execution status (phase + the deposit tx hash once broadcast) for UI
   * progress on receive. The caller uses the hash to jump to the detail page as
   * soon as the wallet tx lands, without waiting for the whole intent to settle.
   */
  onStatus?: (status: TransactionExecutionStatus) => void;
}

export interface EpochExecuteResult {
  direction: FlowMode;
  /** Intent nonce for status polling (`getIntentStatus(sponsorAddress, nonce)`). */
  intentNonce?: string;
  /** Sponsor / user address the intent status is keyed on (always the EVM 0x). */
  sponsorAddress: string;
  /** User-signed source action: Miden note tx (send) or EVM deposit tx (receive). */
  sourceTxHash?: string;
  /** Committed Miden P2IDE collateral note id (send only). */
  midenNoteId?: string;
  /** Real quoted output amount (human units) from the Epoch API, if available. */
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

function assertCommonArgs(args: RunEpochTransferArgs) {
  epochRouteAssets(args.route);
  if (!isValidAmount(args.amount)) {
    throw new Error("Enter an amount greater than zero.");
  }
  if (!EVM_ADDRESS_RE.test(args.evmAddress.trim())) {
    throw new Error(
      args.route.mode === "send"
        ? "Add a valid 0x recipient address on Sepolia."
        : "Connect a Sepolia wallet before bridging.",
    );
  }
  if (!args.midenAccount.trim()) {
    throw new Error(
      args.route.mode === "send"
        ? "Connect your Miden wallet to send."
        : "Add the Miden account that should receive the funds.",
    );
  }
}

/** Miden→EVM: P2IDE collateral note + Epoch intent. */
async function runEpochSend(
  args: RunEpochTransferArgs,
): Promise<EpochExecuteResult> {
  if (!args.requestTransaction || !args.waitForTransaction) {
    throw new Error("Connect your Miden wallet to sign the send.");
  }

  const evmRecipient = args.evmAddress.trim() as `0x${string}`;
  const senderAddress = args.midenAccount.trim();

  const sdk = await getEpochReadOnlySdk(evmRecipient);

  const { miden, evm } = epochRouteAssets(args.route);
  const params: CrossChainIntentParams = {
    midenAccountId: senderAddress,
    midenFaucetId: miden.faucetId,
    midenAmount: parseUnits(
      args.amount,
      miden.decimals,
    ).toString(),
    evmRecipient,
    destinationChainId: EPOCH_DESTINATION_CHAIN_ID,
    outputTokenAddress: evm.address,
    minTokenOut: "0",
  };

  // The note is minted inside solveIntent; capture its id/hash for the activity.
  let noteOutcome: { noteId: string; txHash: string } | undefined;
  const createMidenP2IDENote: CreateMidenP2IDENote = createBridgeP2IDENoteCallback(
    {
      requestTransaction: args.requestTransaction,
      waitForTransaction: args.waitForTransaction,
      senderAddress,
      onNoteCreated: (info) => {
        noteOutcome = info;
        args.onSubmitted?.({ sourceTxHash: info.txHash, midenNoteId: info.noteId });
      },
    },
  );

  const quote = await getCrossChainQuote(sdk, params, evmRecipient);
  const result = await buildCrossChainIntent(sdk, {
    ...params,
    createMidenP2IDENote,
    preFetchedQuote: quote,
  });

  if (result.error) throw new Error(result.error);

  return {
    direction: "send",
    intentNonce: result.solveResult?.nonce,
    sponsorAddress: evmRecipient,
    sourceTxHash: noteOutcome?.txHash,
    midenNoteId: noteOutcome?.noteId,
    outputAmount: epochOutputAmount(quote, evm.decimals),
    raw: result,
  };
}

/** EVM→Miden: Compact deposit (user signs) + Epoch intent. */
async function runEpochReceive(
  args: RunEpochTransferArgs,
): Promise<EpochExecuteResult> {
  const evmSource = args.evmAddress.trim() as `0x${string}`;
  const midenRecipient = args.midenAccount.trim();

  const sdk = await getEpochSdk();
  if (!sdk) throw new Error("Connect a Sepolia wallet to bridge via Epoch.");

  const { miden, evm } = epochRouteAssets(args.route);
  const params: EVMToMidenIntentParams = {
    destinationChainId: MIDEN_DESTINATION_CHAIN_ID,
    evmSourceAddress: evmSource,
    evmTokenAddress: evm.address,
    evmAmount: args.amount,
    evmTokenDecimals: evm.decimals,
    midenRecipientId: midenRecipient,
    midenFaucetId: miden.faucetId,
    minTokenOut: "0",
  };

  const quote = await getEVMToMidenQuote(sdk, params, evmSource);
  const result = await buildEVMToMidenIntent(sdk, {
    ...params,
    preFetchedQuote: quote,
    onExecutionStatus: (status) => {
      args.onStatus?.(status);
      if (status.phase === "sent" && status.transactionIndex === status.totalTransactions - 1 &&
          status.transactionHash && /^0x[\da-f]{64}$/i.test(status.transactionHash)) {
        args.onSubmitted?.({ sourceTxHash: status.transactionHash });
      }
    },
  });

  if (result.error) throw new Error(result.error);

  return {
    direction: "receive",
    intentNonce: result.solveResult?.nonce,
    sponsorAddress: evmSource,
    sourceTxHash: result.solveResult?.depositResult?.transactionHash,
    outputAmount: epochOutputAmount(quote, miden.decimals),
    raw: result,
  };
}

/** Execute an Epoch transfer end-to-end. Dispatches on direction. */
export async function runEpochTransfer(
  args: RunEpochTransferArgs,
): Promise<EpochExecuteResult> {
  assertCommonArgs(args);
  if (isE2E() && e2eNetwork() === "mock") {
    const sourceTxHash = `0x${"ab".repeat(32)}`;
    args.onSubmitted?.({ sourceTxHash });
    return {
      direction: args.route.mode,
      intentNonce: "42",
      sponsorAddress: args.evmAddress.trim(),
      sourceTxHash,
      midenNoteId: args.route.mode === "send" ? `0x${"cd".repeat(32)}` : undefined,
      outputAmount: "0.99",
      raw: {} as IntentResult,
    };
  }
  return args.route.mode === "send" ? runEpochSend(args) : runEpochReceive(args);
}
