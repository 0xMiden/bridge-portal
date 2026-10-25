import { normalizeMidenAccountHex } from "../../miden-address";
import { currentBridgeConfig, configMidenNetwork, type BridgeConfig } from "../../../config/bridge-config";
import { evmNetworks } from "../../../config/evm-networks";
import { encodeFunctionData, parseUnits, toHex } from "viem";
import type { EvmAsset } from "../../core/assets";

export function agglayerConfig(deployment: BridgeConfig = currentBridgeConfig("testnet")) {
  const evmNetwork: "ethereum" | "sepolia" = deployment.environment === "mainnet" ? "ethereum" : "sepolia";
  const chain = evmNetworks[evmNetwork];
  const bridge = deployment.document.supportedEvmChains[evmNetwork]?.bridges.agglayer;
  if (!bridge?.contractAddress || !bridge.midenBridgeId) throw new Error("Agglayer is not configured.");
  return {
    evmNetwork, chain, midenBridgeId: bridge.midenBridgeId,
    sepoliaChainId: chain.id, sepoliaChainHex: `0x${chain.id.toString(16)}`,
    sepoliaBridgeAddress: bridge.contractAddress,
    destinationNetworkId: deployment.derived.rollupId,
    midenIndexerNetworkId: deployment.derived.rollupId,
    sourceNetworkId: 0,
    nativeTokenAddress: "0x0000000000000000000000000000000000000000" as const,
    gasLimit: 300000n,
    bridgeServiceApi: deployment.document["bridge-providers"].agglayer.indexerUrl,
    sepoliaRpcUrl: chain.rpcUrls.default.http[0],
    sepoliaExplorer: chain.blockExplorers.default.url,
    midenExplorer: configMidenNetwork(deployment).explorer,
    midenEthFaucetIdHex: deployment.derived.eth.faucetId,
    midenEthDecimals: deployment.derived.eth.decimals,
  };
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

export function midenAccountToBridgeDestination(value: string) {
  const midenAccount = normalizeMidenAccountHex(value);
  return `0x00000000${midenAccount}00` as `0x${string}`;
}

export function buildDepositTransaction({
  amount,
  asset,
  midenAccountId,
}: {
  amount: string;
  asset: EvmAsset;
  midenAccountId: string;
}, recovery?: BridgeConfig) {
  const AGGLAYER_TESTNET = agglayerConfig(recovery);
  const amountRaw = parseUnits(amount, asset.decimals);
  if (amountRaw <= 0n) {
    throw new Error("Enter an amount greater than zero.");
  }

  const destinationAddress = midenAccountToBridgeDestination(midenAccountId);
  const data = encodeFunctionData({
    abi: bridgeAssetAbi,
    functionName: "bridgeAsset",
    args: [
      AGGLAYER_TESTNET.destinationNetworkId,
      destinationAddress,
      amountRaw,
      asset.kind === "erc20" ? asset.address : AGGLAYER_TESTNET.nativeTokenAddress,
      true,
      "0x",
    ],
  });

  return {
    to: AGGLAYER_TESTNET.sepoliaBridgeAddress,
    data,
    value: toHex(asset.kind === "native" ? amountRaw : 0n),
    gas: toHex(AGGLAYER_TESTNET.gasLimit),
    destinationAddress,
  };
}

export function bridgeStatusUrl(destinationAddress: string, recovery?: BridgeConfig) {
  const AGGLAYER_TESTNET = agglayerConfig(recovery);
  return `${AGGLAYER_TESTNET.bridgeServiceApi}/bridges/${destinationAddress}?limit=1&offset=0`;
}
