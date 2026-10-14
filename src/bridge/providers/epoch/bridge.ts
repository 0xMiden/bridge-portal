import {
  CollateralType,
  EpochIntentSDK,
  EVM_TO_MIDEN_EXTRA_TYPESTRING,
  GetTaskDataParams,
  IntentQuoteResult,
  MIDEN_TO_EVM_EXTRA_TYPESTRING,
  SolveIntentParams,
  TaskType,
} from "@epoch-protocol/epoch-intents-sdk";
import { AccountId, Address } from "@miden-sdk/miden-sdk";
import { parseUnits } from "viem";

import { MIDEN_DESTINATION_CHAIN_ID } from "./config";
import type {
  CrossChainIntentParams,
  EVMToMidenIntentParams,
  IntentResult,
} from "./types";

/** True when an error is the user declining a wallet prompt (code 4001 / text). */
function isUserRejectionError(err: unknown): boolean {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === 4001
  ) {
    return true;
  }
  const message = (
    err instanceof Error ? err.message : String(err ?? "")
  ).toLowerCase();
  return (
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("denied transaction") ||
    message.includes("rejected the request")
  );
}

export interface CrossChainQuote {
  taskTypeString: string;
  intentData: unknown;
  quoteResult: IntentQuoteResult;
  params: CrossChainIntentParams;
}

/** Pre-fetched EVM->Miden quote for the typed EVM input amount. */
export interface EVMToMidenQuote {
  taskTypeString: string;
  intentData: unknown;
  quoteResult: IntentQuoteResult;
  params: EVMToMidenIntentParams;
}

/**
 * Cross-chain bridge architecture using P2ID notes:
 *
 * 1. User creates a P2ID note on Miden targeting the trusted allocator service
 * 2. The allocator service (holding the P2ID note) builds an Epoch intent via SIO
 * 3. SIO solver fulfills the intent on the destination EVM chain
 * 4. On successful execution, the allocator consumes the P2ID note (claiming the Miden funds)
 * 5. If the intent fails/expires, the P2ID note can be recalled by the user
 *
 * This keeps funds locked in a P2ID note (not custodied) until the cross-chain
 * intent is fulfilled — privacy-preserving on the Miden side, trustless on EVM side.
 */

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export function normalizeMidenIdToHex(id: string): string {
  const raw = id.trim();
  if (/^(?:0x)?[0-9a-f]+$/i.test(raw)) {
    return AccountId.fromHex(`0x${raw.replace(/^0x/i, "")}`).toString();
  }
  return raw.includes("_")
    ? Address.fromBech32(raw).accountId().toString()
    : AccountId.fromBech32(raw).toString();
}

export function buildEpochTaskDataParams(
  params: CrossChainIntentParams,
): GetTaskDataParams {
  const midenSourceAccountHex = normalizeMidenIdToHex(params.midenAccountId);
  const midenFaucetIdHex = normalizeMidenIdToHex(params.midenFaucetId);

  const taskDataParams = {
    taskType: TaskType.GetTokenOut,
    intentData: {
      // isNative must be false — tokenIn is zero-address (Miden-sourced) but tokenOut is a real EVM token
      isNative: false,
      depositTokenAddress: ZERO_ADDRESS,
      tokenInAmount: params.midenAmount,
      outputTokenAddress: params.outputTokenAddress,
      minTokenOut: params.minTokenOut,
      destinationChainId: String(params.destinationChainId),
      protocolHashIdentifier: ZERO_HASH,
      recipient: params.evmRecipient,
    },
    extraDataTypestring: MIDEN_TO_EVM_EXTRA_TYPESTRING,
    extraData: {
      midenSourceAccount: midenSourceAccountHex,
      midenFaucetId: midenFaucetIdHex,
      midenNoteType: "P2IDE",
      midenNoteId: "",
    },
  };

  return taskDataParams;
}

export function buildEVMToMidenTaskDataParams(params: EVMToMidenIntentParams) {
  const midenRecipientHex = normalizeMidenIdToHex(params.midenRecipientId);
  const midenFaucetHex = normalizeMidenIdToHex(params.midenFaucetId);
  const amountInWei = parseUnits(params.evmAmount, params.evmTokenDecimals).toString();
  const destinationChainId = params.destinationChainId;
  if (destinationChainId !== MIDEN_DESTINATION_CHAIN_ID) {
    throw new Error(
      `EVM→Miden: destinationChainId must be ${MIDEN_DESTINATION_CHAIN_ID} (Miden output). Got ${destinationChainId}.`,
    );
  }

  const taskDataParams = {
    taskType: TaskType.GetTokenOut,
    intentData: {
      isNative: false,
      depositTokenAddress: params.evmTokenAddress,
      tokenInAmount: amountInWei,
      outputTokenAddress: ZERO_ADDRESS,
      minTokenOut: params.minTokenOut, // Miden-side minimum out (base units)
      destinationChainId: String(destinationChainId),
      protocolHashIdentifier: ZERO_HASH,
      recipient: params.evmSourceAddress,
    },
    extraDataTypestring: EVM_TO_MIDEN_EXTRA_TYPESTRING,
    extraData: {
      midenRecipientAccount: midenRecipientHex,
      midenFaucetId: midenFaucetHex,
    },
  };

  return taskDataParams;
}

/** Step 1: quote EVM->Miden using the provided EVM input amount. */
export async function getEVMToMidenQuote(
  sdk: EpochIntentSDK,
  params: EVMToMidenIntentParams,
  sponsorAddress: string,
): Promise<EVMToMidenQuote> {
  const taskDataParams = buildEVMToMidenTaskDataParams(params);
  const { taskTypeString, intentData } = await sdk.getTaskData(taskDataParams);

  const quoteResult = await sdk.getIntentQuote({
    sponsorAddress: sponsorAddress as `0x${string}`,
    taskTypeString,
    intentData,
    isNative: false,
  });

  if (!quoteResult.success) {
    throw new Error(quoteResult.error ?? "Quote failed");
  }

  return { taskTypeString, intentData, quoteResult, params };
}

export async function buildEVMToMidenIntent(
  sdk: EpochIntentSDK,
  params: EVMToMidenIntentParams & {
    preFetchedQuote: EVMToMidenQuote;
    // Live progress from the SDK's deposit/approve execution — surfaced to the
    // UI so the button reflects each phase instead of appearing frozen.
    onExecutionStatus?: SolveIntentParams["onExecutionStatus"];
  },
): Promise<IntentResult> {
  const { taskTypeString, intentData, quoteResult } = params.preFetchedQuote;

  try {
    const solveResult = await sdk.solveIntent({
      isNative: false,
      sponsorAddress: params.evmSourceAddress as `0x${string}`,
      taskTypeString,
      intentData,
      quoteResult,
      collateralType: CollateralType.EVM,
      onExecutionStatus: params.onExecutionStatus,
    });

    return {
      taskTypeString,
      intentData: intentData as Record<string, unknown>,
      solveResult,
    };
  } catch (err) {
    // A wallet rejection is expected user behaviour — don't log it as an error.
    if (!isUserRejectionError(err)) {
      console.error("[EpochBridge] EVM→Miden solveIntent failed:", err);
    }
    return {
      taskTypeString,
      intentData: intentData as Record<string, unknown>,
      error:
        err instanceof Error ? err.message : "Failed to solve EVM→Miden intent",
    };
  }
}

/** Quote the EVM output for the supplied Miden input amount. */
export async function getCrossChainQuote(
  sdk: EpochIntentSDK,
  params: CrossChainIntentParams,
  sponsorAddress: string,
): Promise<CrossChainQuote> {
  const taskDataParams = buildEpochTaskDataParams(params);
  const { taskTypeString, intentData } = await sdk.getTaskData(taskDataParams);

  const quoteResult = await sdk.getIntentQuote({
    sponsorAddress: sponsorAddress as `0x${string}`,
    taskTypeString,
    intentData,
    isNative: false,
  });

  if (!quoteResult.success) {
    throw new Error(quoteResult.error ?? "Quote failed");
  }

  return { taskTypeString, intentData, quoteResult, params };
}

export async function buildCrossChainIntent(
  sdk: EpochIntentSDK,
  params: CrossChainIntentParams & {
    createMidenP2IDENote: NonNullable<SolveIntentParams["createMidenP2IDENote"]>;
    preFetchedQuote: CrossChainQuote;
  },
): Promise<IntentResult> {
  const midenFaucetIdHex = normalizeMidenIdToHex(params.midenFaucetId);
  const midenSourceHex = normalizeMidenIdToHex(params.midenAccountId);
  const { taskTypeString, intentData, quoteResult } = params.preFetchedQuote;

  try {
    const solveResult = await sdk.solveIntent({
      isNative: false,
      sponsorAddress: params.evmRecipient as `0x${string}`,
      taskTypeString,
      intentData,
      quoteResult,
      collateralType: CollateralType.Miden,
      midenFaucetId: midenFaucetIdHex,
      midenSourceAccount: midenSourceHex,
      createMidenP2IDENote: params.createMidenP2IDENote,
    });

    return {
      taskTypeString,
      intentData: intentData as Record<string, unknown>,
      solveResult, // Include the full execution result
    };
  } catch (err) {
    if (!isUserRejectionError(err)) {
      console.error("[EpochBridge] solveIntent failed:", err);
    }
    // Still return the task data even if solve fails
    return {
      taskTypeString,
      intentData: intentData as Record<string, unknown>,
      error: err instanceof Error ? err.message : "Failed to solve intent",
    };
  }
}
