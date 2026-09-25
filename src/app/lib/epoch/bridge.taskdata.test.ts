import { describe, expect, it, vi } from "vitest";
import { EpochIntentSDK, EVM_TO_MIDEN_EXTRA_TYPESTRING, MIDEN_TO_EVM_EXTRA_TYPESTRING, TaskType } from "@epoch-protocol/epoch-intents-sdk";
import { createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";

vi.mock("@miden-sdk/miden-sdk", () => ({
  AccountId: { fromHex: (value: string) => ({ toString: () => value }) },
}));

import { MIDEN_NATIVE_FAUCET_ID } from "./config";
import { buildEpochTaskDataParams, buildEVMToMidenTaskDataParams } from "./bridge";

const SPONSOR = "0x1111111111111111111111111111111111111111";
const ACCOUNT = "0x387149ae66116cf114eebd60bb7381";
const TOKEN = "0x2BB4FfD7E2c6D432b697554Efd77fA13bdbefd69";
const sdk = new EpochIntentSDK({
  apiBaseUrl: "https://unused.invalid",
  walletClient: createWalletClient({ account: SPONSOR, chain: sepolia, transport: http() }),
});

describe("Epoch SDK task data compatibility", () => {
  it("builds a Miden send accepted by the real SDK using its canonical witness", async () => {
    const params = buildEpochTaskDataParams({
      midenAccountId: ACCOUNT, midenFaucetId: MIDEN_NATIVE_FAUCET_ID,
      midenAmount: "1000000", evmRecipient: SPONSOR,
      destinationChainId: 11155111, outputTokenAddress: TOKEN, minTokenOut: "0",
    });
    expect(params.taskType).toBe(TaskType.GetTokenOut);
    expect(params.extraDataTypestring).toBe(MIDEN_TO_EVM_EXTRA_TYPESTRING);
    const task = await sdk.getTaskData(params);
    expect(task.intentData).toMatchObject({ tokenInAmount: "1000000", midenNoteType: "P2IDE", midenNoteId: "" });
    expect(task.intentData).not.toHaveProperty("midenReclaimHeight");
  });

  it("builds a Sepolia receive with the current USDC faucet and atomic input amount", async () => {
    const params = buildEVMToMidenTaskDataParams({
      sourceChainId: 11155111, destinationChainId: 999999999,
      evmSourceAddress: SPONSOR, evmTokenAddress: TOKEN, evmAmount: "1.25",
      evmTokenDecimals: 18, midenRecipientId: ACCOUNT,
      midenFaucetId: MIDEN_NATIVE_FAUCET_ID, minTokenOut: "0",
    });
    expect(params.extraDataTypestring).toBe(EVM_TO_MIDEN_EXTRA_TYPESTRING);
    const task = await sdk.getTaskData(params);
    expect(task.intentData).toMatchObject({
      tokenInAmount: "1250000000000000000", destinationChainId: "999999999",
      midenRecipientAccount: ACCOUNT, midenFaucetId: "0x537c15a622074e91188aa894456c52",
    });
    expect(task.intentData).not.toHaveProperty("midenSourceAccount");
  });
});
