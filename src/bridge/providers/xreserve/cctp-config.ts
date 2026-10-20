import { parseAbi } from "viem";
import { evmNetworks } from "../../../config/evm-networks";
import { getDeployment, deploymentArcNetwork } from "../../../config/deployments";
import type { EvmAsset, EvmNetwork } from "../../core/assets";

export type CctpNetwork = "sepolia" | "base-sepolia" | "arbitrum-sepolia" | "ethereum" | "base" | "arbitrum";
export function cctpSource(network: CctpNetwork, deploymentId?: string) {
  const route = getDeployment(deploymentId).document.supportedEvmChains[network]?.bridges.usdcx;
  if (!route?.tokens?.USDC || route.domain === undefined || route.deposit?.route !== "executor")
    throw new Error("Unsupported Circle source network.");
  return { domain: route.domain, chain: evmNetworks[network], asset: {
    network, kind: "erc20", symbol: "USDC", name: "Circle USDC", decimals: 6,
    address: route.tokens.USDC.contractAddress,
  } as EvmAsset & { kind: "erc20" } };
}
export function isCctpNetwork(network: string): network is CctpNetwork {
  return ["sepolia", "base-sepolia", "arbitrum-sepolia", "ethereum", "base", "arbitrum"].includes(network);
}
export function cctpConfig(deploymentId?: string, network?: EvmNetwork) {
  const deployment = getDeployment(deploymentId);
  const arc = deployment.document.supportedEvmChains[deploymentArcNetwork(deploymentId)]?.bridges.usdcx;
  const source = deployment.document.supportedEvmChains[network ?? (deployment.environment === "mainnet" ? "ethereum" : "sepolia")]?.bridges.usdcx;
  if (!arc?.executor || !source?.deposit?.tokenMessenger || !source.deposit.tokenMessengerWithFees)
    throw new Error("Circle forwarding is not configured.");
  return {
    api: deployment.document["bridge-providers"].usdcx.irisUrl,
    executor: arc.executor.address, handler: arc.executor.handler,
    tokenMessenger: source.deposit.tokenMessenger,
    tokenMessengerWithFees: source.deposit.tokenMessengerWithFees,
    // CCTP V2 localMessageTransmitter(), independently checked on both Ethereum deployments.
    messageTransmitter: (deployment.environment === "mainnet"
      ? "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64"
      : "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275") as `0x${string}`,
  };
}
export const cctpAbi = parseAbi([
  "function depositForBurnWithHookAndFees(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,bytes hookData,(bytes signedQuote,address refundAddress) claim) payable",
  "function getFee(bytes signedQuote) view returns (uint256 totalFee,address feeToken)",
]);
