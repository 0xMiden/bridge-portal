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

export function isMidenAccountHex(value: string) {
  return /^[0-9a-fA-F]{30}$/.test(value.trim().replace(/^0x/, ""));
}

const BECH32M_CONST = 0x2bc830a3;
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Polymod(values: number[]) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;

  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    chk = generators.reduce((value, generator, i) =>
      ((top >> i) & 1) ? value ^ generator : value, chk);
  }

  return chk;
}

function bech32HrpExpand(hrp: string) {
  const expanded: number[] = [];
  for (let i = 0; i < hrp.length; i += 1) expanded.push(hrp.charCodeAt(i) >> 5);
  expanded.push(0);
  for (let i = 0; i < hrp.length; i += 1) expanded.push(hrp.charCodeAt(i) & 31);
  return expanded;
}

function convertBits(data: number[], fromBits: number, toBits: number) {
  let acc = 0;
  let bits = 0;
  const maxv = (1 << toBits) - 1;
  const result: number[] = [];

  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) throw new Error("Invalid Miden bech32 address.");
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }

  if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new Error("Invalid Miden bech32 address padding.");
  }

  return result;
}

function midenBech32AccountToHex(value: string) {
  const identifier = value.trim().split("_")[0];
  const lower = identifier.toLowerCase();
  if (identifier !== lower && identifier !== identifier.toUpperCase()) {
    throw new Error("Miden bech32 addresses cannot mix uppercase and lowercase characters.");
  }

  const separator = lower.lastIndexOf("1");
  if (separator < 1 || separator + 7 > lower.length) {
    throw new Error("Invalid Miden bech32 address.");
  }

  const hrp = lower.slice(0, separator);
  const values = [...lower.slice(separator + 1)].map((char) => {
    const index = BECH32_CHARSET.indexOf(char);
    if (index === -1) throw new Error("Invalid Miden bech32 address character.");
    return index;
  });

  if (bech32Polymod([...bech32HrpExpand(hrp), ...values]) !== BECH32M_CONST) {
    throw new Error("Invalid Miden bech32 checksum.");
  }

  // Miden account addresses encode one address-type byte followed by the 15-byte account ID.
  const bytes = convertBits(values.slice(0, -6), 5, 8);
  if (bytes.length !== 16 || bytes[0] !== 232) {
    throw new Error("Expected a Miden account ID address.");
  }

  return bytes
    .slice(1)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeMidenAccountHex(value: string) {
  const normalized = value.trim().replace(/^0x/, "");
  if (isMidenAccountHex(normalized)) return normalized.toLowerCase();
  return midenBech32AccountToHex(value);
}

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
