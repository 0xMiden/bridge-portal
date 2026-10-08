import { parseAbi } from "viem";
import { CIRCLE_SEPOLIA_USDC, BASE_SEPOLIA_USDC, ARBITRUM_SEPOLIA_USDC } from "../../core/assets";
import { evmNetworks } from "../../../config/evm-networks";

export const cctpSources = {
  sepolia: { domain: 0, asset: CIRCLE_SEPOLIA_USDC, chain: evmNetworks.sepolia },
  "base-sepolia": { domain: 6, asset: BASE_SEPOLIA_USDC, chain: evmNetworks["base-sepolia"] },
  "arbitrum-sepolia": { domain: 3, asset: ARBITRUM_SEPOLIA_USDC, chain: evmNetworks["arbitrum-sepolia"] },
} as const;
export type CctpNetwork = keyof typeof cctpSources;
export function isCctpNetwork(network: string): network is CctpNetwork {
  return Object.hasOwn(cctpSources, network);
}

// Testnet proxies, verified against Arc explorer source and active deployment.
export const CCTP = {
  api: "https://iris-api-sandbox.circle.com",
  executor: "0xEdC81040756AcCfF070c21D37b265b9D0b5Ba45e",
  handler: "0xD05E7D2E7d30b92c5F17d7d0fC575fce231F1A48",
  tokenMessengerWithFees: "0x8745D906D67C346E5eb1aEEED38Eb87F34DF0C0A",
  messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
  tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
} as const;

export const cctpAbi = parseAbi([
  "function depositForBurnWithHookAndFees(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,bytes hookData,(bytes signedQuote,address refundAddress) claim) payable",
  "function getFee(bytes signedQuote) view returns (uint256 totalFee,address feeToken)",
]);
