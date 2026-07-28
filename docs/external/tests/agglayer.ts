import {
  AccountId,
  AssetCallbackFlag,
  EthAddress,
  FungibleAsset,
  Note,
  NoteArray,
  NoteAssets,
  TransactionRequestBuilder,
} from "@miden-sdk/miden-sdk";
import { Transaction } from "@miden-sdk/miden-wallet-adapter-base";
import { encodeFunctionData, parseEther, toHex } from "viem";

export const AGGLAYER_BALI = {
  sepoliaChainId: 11155111,
  sepoliaBridgeAddress: "0x1348947e282138d8f377b467f7d9c2eb0f335d1f",
  midenNetworkId: 78,
  evmNetworkId: 0,
  nativeTokenAddress: "0x0000000000000000000000000000000000000000",
  midenBridgeId: "0xa22ec154f9a36d911953fd5c9260a7",
  midenEthFaucetId: "0x387149ae66116cf114eebd60bb7381",
  bridgeServiceApi:
    "https://miden-testnet-bridge.dev.eu-north-3.gateway.fm/api",
} as const;

export function midenAccountToBridgeDestination(accountId: string) {
  const normalized = accountId.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{30}$/.test(normalized)) {
    throw new Error("Expected a 15-byte Miden account ID.");
  }

  return `0x00000000${normalized.toLowerCase()}00` as `0x${string}`;
}

const bridgeAssetAbi = [
  {
    type: "function",
    name: "bridgeAsset",
    stateMutability: "payable",
    inputs: [
      { name: "destinationNetwork", type: "uint32" },
      { name: "destinationAddress", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "token", type: "address" },
      { name: "forceUpdateGlobalExitRoot", type: "bool" },
      { name: "permitData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export function buildBridgeInTransaction(
  amountEth: string,
  midenAccountId: string,
) {
  const amount = parseEther(amountEth);
  const destinationAddress =
    midenAccountToBridgeDestination(midenAccountId);

  return {
    to: AGGLAYER_BALI.sepoliaBridgeAddress,
    data: encodeFunctionData({
      abi: bridgeAssetAbi,
      functionName: "bridgeAsset",
      args: [
        AGGLAYER_BALI.midenNetworkId,
        destinationAddress,
        amount,
        AGGLAYER_BALI.nativeTokenAddress,
        true,
        "0x",
      ],
    }),
    value: toHex(amount),
    gas: toHex(BigInt(300000)),
    destinationAddress,
  };
}

export async function fetchAgglayerDeposits(destinationAddress: string) {
  const response = await fetch(
    `${AGGLAYER_BALI.bridgeServiceApi}/bridges/${destinationAddress}?limit=10&offset=0`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`Agglayer bridge status ${response.status}`);
  }

  return (await response.json()).deposits;
}

export async function createAgglayerBridgeOut({
  amount,
  destinationAddress,
  senderAddress,
  requestTransaction,
  waitForTransaction,
}: {
  amount: bigint;
  destinationAddress: string;
  senderAddress: string;
  requestTransaction: (transaction: Transaction) => Promise<string>;
  waitForTransaction: (requestId: string) => Promise<{ txHash: string }>;
}) {
  const sender = AccountId.fromBech32(senderAddress);
  const bridge = AccountId.fromHex(AGGLAYER_BALI.midenBridgeId);
  const faucet = AccountId.fromHex(AGGLAYER_BALI.midenEthFaucetId);

  const asset = new FungibleAsset(faucet, amount).withCallbacks(
    AssetCallbackFlag.Enabled,
  );
  const note = Note.createB2AggNote(
    sender,
    bridge,
    new NoteAssets([asset]),
    AGGLAYER_BALI.evmNetworkId,
    EthAddress.fromHex(destinationAddress),
  );
  const request = new TransactionRequestBuilder()
    .withOwnOutputNotes(new NoteArray([note]))
    .build();
  const transaction = Transaction.createCustomTransaction(
    senderAddress,
    senderAddress,
    request,
  );

  const requestId = await requestTransaction(transaction);
  const output = await waitForTransaction(requestId);
  return output.txHash;
}
