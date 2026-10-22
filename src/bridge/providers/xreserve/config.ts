import { parseAbi, type Address } from "viem";
import { getDeployment, deploymentArcNetwork } from "../../../config/deployments";
import { evmNetworks } from "../../../config/evm-networks";
import type { EvmAsset, EvmNetwork } from "../../core/assets";
export { arcTestnet } from "../../../config/arc";

export function arcConfig(deploymentId?: string) {
  const deployment = getDeployment(deploymentId);
  const network = deploymentArcNetwork(deploymentId);
  const chain = evmNetworks[network];
  const route = deployment.document.supportedEvmChains[network]?.bridges.usdcx;
  const services = deployment.document["bridge-providers"].usdcx;
  if (!route?.deposit?.xReserve || !route.tokens?.USDC || route.domain === undefined)
    throw new Error("The xReserve deployment is unavailable.");
  return {
    network, chain, chainId: chain.id, circleDomain: route.domain,
    midenDomain: services.midenDomain, usdc: route.tokens.USDC.contractAddress,
    faucetId: deployment.derived.usdcxFaucetId, xReserve: route.deposit.xReserve,
    decimals: 6, maxFee: 0n, attestationApi: services.attestationUrl,
    explorer: chain.blockExplorers.default.url,
  };
}
export const ARC = arcConfig();

export const xReserveAbi = parseAbi([
  "function isRemoteDomainRegistered(uint32 remoteDomain) view returns (bool)",
  "function getRemoteToken(uint32 remoteDomain, address localToken) view returns (bytes32)",
  "function depositToRemote(uint256 value, uint32 remoteDomain, bytes32 remoteRecipient, address localToken, uint256 maxFee, bytes hookData)",
  "event DepositedToRemote(address indexed localToken, uint256 value, address indexed localDepositor, bytes32 indexed remoteRecipient, uint32 remoteDomain, bytes32 remoteToken, uint256 maxFee, bytes hookData)",
]);

// miden-protocol AssetAmount::MAX. The faucet cannot mint arbitrary u64 amounts.
export const ARC_MAX_MIDEN_AMOUNT = (1n << 63n) - (1n << 31n);

export const cctpNetworks = ["sepolia", "base-sepolia", "arbitrum-sepolia", "ethereum", "base", "arbitrum"] as const;
export type CctpNetwork = typeof cctpNetworks[number];
export function cctpSource(network: CctpNetwork, deploymentId?: string) {
  const route = getDeployment(deploymentId).document.supportedEvmChains[network]?.bridges.usdcx;
  if (!route?.tokens?.USDC || route.domain === undefined || route.deposit?.route !== "executor")
    throw new Error("Unsupported Circle source network.");
  return { domain: route.domain, chain: evmNetworks[network], asset: {
    network, kind: "erc20", symbol: "USDC", name: "Circle USDC", decimals: 6,
    address: route.tokens.USDC.contractAddress,
  } satisfies EvmAsset & { kind: "erc20" } };
}
export function isCctpNetwork(network: string): network is CctpNetwork {
  return cctpNetworks.some(candidate => candidate === network);
}
export function cctpConfig(deploymentId?: string, network?: EvmNetwork) {
  const deployment = getDeployment(deploymentId);
  const arc = deployment.document.supportedEvmChains[deploymentArcNetwork(deploymentId)]?.bridges.usdcx;
  const source = deployment.document.supportedEvmChains[network ?? (deployment.environment === "mainnet" ? "ethereum" : "sepolia")]?.bridges.usdcx;
  if (!arc?.executor || !source?.deposit?.tokenMessenger || !source.deposit.tokenMessengerWithFees)
    throw new Error("Circle forwarding is not configured.");
  // CCTP V2 localMessageTransmitter(), independently checked on both Ethereum deployments.
  const messageTransmitter: Address = deployment.environment === "mainnet"
    ? "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64"
    : "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
  return {
    api: deployment.document["bridge-providers"].usdcx.irisUrl,
    executor: arc.executor.address, handler: arc.executor.handler,
    tokenMessenger: source.deposit.tokenMessenger,
    tokenMessengerWithFees: source.deposit.tokenMessengerWithFees,
    messageTransmitter,
  };
}
export const cctpAbi = parseAbi([
  "error QuoteExpired(uint8 mode,uint256 deadline,uint256 current)",
  "function depositForBurnWithHookAndFees(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,bytes hookData,(bytes signedQuote,address refundAddress) claim) payable",
  "function getFee(bytes signedQuote) pure returns (uint256 totalFee,address feeToken)",
]);
