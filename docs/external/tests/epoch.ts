import { createFeeConversionSalt } from "../../../src/app/lib/miden-transaction";
import {
  CollateralType,
  EpochIntentSDK,
  EVM_TO_MIDEN_EXTRA_TYPESTRING,
  MIDEN_TO_EVM_EXTRA_TYPESTRING,
  TaskType,
} from "@epoch-protocol/epoch-intents-sdk";
import {
  AccountId,
  AccountInterface,
  NetworkId,
  FungibleAsset,
  Note,
  NoteArray,
  NoteAssets,
  NoteAttachment,
  NoteType,
  TransactionRequestBuilder,
} from "@miden-sdk/miden-sdk";
import {
  createWalletClient,
  custom,
  type Chain,
  type EIP1193Provider,
} from "viem";
import { sepolia } from "viem/chains";
import { Transaction, type MidenTransaction } from "@miden-sdk/miden-wallet-adapter-base";

export const EPOCH_ALLOCATOR_URL =
  "https://testnet-dev.epochprotocol.xyz";
export const MIDEN_CHAIN_ID = 999999999;
export const SEPOLIA_CHAIN_ID = 11155111;

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
  requestTransaction: (transaction: MidenTransaction) => Promise<string>;
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
  requestTransaction,
  waitForTransaction,
}: EpochSnippetDeps) {

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
    extraDataTypestring: MIDEN_TO_EVM_EXTRA_TYPESTRING,
    extraData: {
      midenSourceAccount,
      midenFaucetId,
      midenNoteType: "P2IDE",
      midenNoteId: "",
    },
  });

  const quote = await sdk.getIntentQuote({
    sponsorAddress: evmRecipient,
    taskTypeString: task.taskTypeString,
    intentData: task.intentData,
    isNative: false,
  });

  const createMidenP2IDENote = async (
    faucetId: string,
    amount: string,
    allocatorId: string,
    recallBlocks: number,
    bindingAttachmentFelts: bigint[],
  ) => {
    const currentBlock = await getCurrentMidenBlock();
    const reclaimHeight = currentBlock + recallBlocks;
    if (!Number.isSafeInteger(reclaimHeight) || recallBlocks <= 0 ||
        reclaimHeight > 0xffff_ffff || bindingAttachmentFelts.length === 0) {
      throw new Error("Invalid Epoch collateral parameters");
    }
    const toAccountId = (value: string) => value.startsWith("0x")
      ? AccountId.fromHex(value) : AccountId.fromBech32(value);
    const note = Note.createP2IDENote(
      toAccountId(midenSourceAccount),
      toAccountId(allocatorId),
      new NoteAssets([new FungibleAsset(toAccountId(faucetId), BigInt(amount))]),
      reclaimHeight,
      null,
      NoteType.Public,
      new NoteAttachment(BigUint64Array.from(bindingAttachmentFelts)),
    );
    const expectedNoteId = note.id().toString();
    const request = new TransactionRequestBuilder()
    .withFeeConversionSalt(createFeeConversionSalt())
      .withOwnOutputNotes(new NoteArray([note]))
      .build();
    const requestId = await requestTransaction(Transaction.createCustomTransaction(
      midenSender, toTestnetAccountAddress(allocatorId), request,
    ));
    const output = await waitForTransaction(requestId);
    const noteId = output.outputNotes?.find(
      (outputNote) => outputNote.id().toString() === expectedNoteId,
    )?.id().toString();
    return noteId ? { success: true, noteId } : { success: false };
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
    createMidenP2IDENote,
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
    extraDataTypestring: EVM_TO_MIDEN_EXTRA_TYPESTRING,
    extraData: {
      midenRecipientAccount,
      midenFaucetId,
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
