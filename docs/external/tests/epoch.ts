import {
  CollateralType,
  EpochIntentSDK,
  TaskType,
} from "@epoch-protocol/epoch-intents-sdk";
import {
  AccountId,
  AccountInterface,
  NetworkId,
} from "@miden-sdk/miden-sdk";
import {
  createWalletClient,
  custom,
  type Chain,
  type EIP1193Provider,
} from "viem";
import { sepolia } from "viem/chains";

export const EPOCH_ALLOCATOR_URL =
  "https://testnet-dev.epochprotocol.xyz";
export const MIDEN_CHAIN_ID = 999999999;
export const SEPOLIA_CHAIN_ID = 11155111;
export const RECLAIM_WINDOW_BLOCKS = 1000;

export function createEpochSdk(
  account: `0x${string}`,
  provider: EIP1193Provider,
  source: "miden" | "sepolia",
) {
  const chain: Chain =
    source === "miden"
      ? { ...sepolia, id: MIDEN_CHAIN_ID }
      : sepolia;
  const walletClient = createWalletClient({
    account,
    chain,
    transport: custom(provider),
  });

  return new EpochIntentSDK({
    apiBaseUrl: EPOCH_ALLOCATOR_URL,
    walletClient,
  });
}

function toTestnetAccountAddress(value: string) {
  return value.startsWith("0x")
    ? AccountId.fromHex(value).toBech32(
        NetworkId.testnet(),
        AccountInterface.BasicWallet,
      )
    : value;
}

type EpochSnippetDeps = {
  sdk: EpochIntentSDK;
  getCurrentMidenBlock: () => Promise<number>;
  midenAmountInBaseUnits: string;
  epochSepoliaUsdcAddress: string;
  minimumEvmOutput: string;
  evmRecipient: `0x${string}`;
  midenSourceAccount: string;
  midenFaucetId: string;
  midenSender: string;
  requestSend: (transaction: {
    senderAddress: string;
    recipientAddress: string;
    faucetId: string;
    noteType: "public";
    amount: number;
    recallBlocks: number;
  }) => Promise<string>;
  waitForTransaction: (requestId: string) => Promise<{
    outputNotes?: Array<{ id(): { toString(): string } }>;
  }>;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export async function verifyMidenToEvmSnippets({
  sdk,
  getCurrentMidenBlock,
  midenAmountInBaseUnits,
  epochSepoliaUsdcAddress,
  minimumEvmOutput,
  evmRecipient,
  midenSourceAccount,
  midenFaucetId,
  midenSender,
  requestSend,
  waitForTransaction,
}: EpochSnippetDeps) {
  const currentBlock = await getCurrentMidenBlock();
  const reclaimHeight = currentBlock + RECLAIM_WINDOW_BLOCKS;

  const task = await sdk.getTaskData({
    taskType: TaskType.GetTokenOut,
    intentData: {
      isNative: false,
      depositTokenAddress: ZERO_ADDRESS,
      tokenInAmount: midenAmountInBaseUnits,
      outputTokenAddress: epochSepoliaUsdcAddress,
      minTokenOut: minimumEvmOutput,
      destinationChainId: String(SEPOLIA_CHAIN_ID),
      protocolHashIdentifier: ZERO_HASH,
      recipient: evmRecipient,
    },
    extraDataTypestring:
      "string midenSourceAccount,string midenFaucetId,string midenNoteType,string midenNoteId,uint256 midenReclaimHeight",
    extraData: {
      midenSourceAccount,
      midenFaucetId,
      midenNoteType: "P2IDE",
      midenNoteId: "",
      midenReclaimHeight: String(reclaimHeight),
    },
  });

  const quote = await sdk.getIntentQuote({
    sponsorAddress: evmRecipient,
    taskTypeString: task.taskTypeString,
    intentData: task.intentData,
    isNative: false,
  });

  const createMidenP2IDNote = async (
    faucetId: string,
    amount: string,
    allocatorId: string,
  ) => {
    const amountBaseUnits = BigInt(amount);
    if (amountBaseUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { success: false };
    }

    const requestId = await requestSend({
      senderAddress: midenSender,
      recipientAddress: toTestnetAccountAddress(allocatorId),
      faucetId: toTestnetAccountAddress(faucetId),
      noteType: "public",
      amount: Number(amountBaseUnits),
      recallBlocks: RECLAIM_WINDOW_BLOCKS,
    });
    const output = await waitForTransaction(requestId);
    const noteId = output.outputNotes?.[0]?.id().toString();

    return noteId
      ? { success: true, noteId }
      : { success: false };
  };

  return sdk.solveIntent({
    isNative: false,
    sponsorAddress: evmRecipient,
    taskTypeString: task.taskTypeString,
    intentData: task.intentData,
    quoteResult: quote,
    collateralType: CollateralType.Miden,
    midenFaucetId,
    midenSourceAccount,
    createMidenP2IDNote,
  });
}

export async function verifyEvmToMidenSnippets({
  sdk,
  epochSepoliaUsdcAddress,
  evmAmountInBaseUnits,
  minimumMidenOutput,
  evmSourceAddress,
  midenRecipientAccount,
  midenFaucetId,
}: {
  sdk: EpochIntentSDK;
  epochSepoliaUsdcAddress: string;
  evmAmountInBaseUnits: string;
  minimumMidenOutput: string;
  evmSourceAddress: `0x${string}`;
  midenRecipientAccount: string;
  midenFaucetId: string;
}) {
  const task = await sdk.getTaskData({
    taskType: TaskType.GetTokenOut,
    intentData: {
      isNative: false,
      depositTokenAddress: epochSepoliaUsdcAddress,
      tokenInAmount: evmAmountInBaseUnits,
      outputTokenAddress: ZERO_ADDRESS,
      minTokenOut: minimumMidenOutput,
      destinationChainId: String(MIDEN_CHAIN_ID),
      protocolHashIdentifier: ZERO_HASH,
      recipient: evmSourceAddress,
    },
    extraDataTypestring:
      "string midenRecipientAccount,string midenFaucetId,string midenNoteType",
    extraData: {
      midenRecipientAccount,
      midenFaucetId,
      midenNoteType: "P2ID",
    },
  });

  const quote = await sdk.getIntentQuote({
    sponsorAddress: evmSourceAddress,
    taskTypeString: task.taskTypeString,
    intentData: task.intentData,
    isNative: false,
  });

  return sdk.solveIntent({
    isNative: false,
    sponsorAddress: evmSourceAddress,
    taskTypeString: task.taskTypeString,
    intentData: task.intentData,
    quoteResult: quote,
    collateralType: CollateralType.EVM,
  });
}
