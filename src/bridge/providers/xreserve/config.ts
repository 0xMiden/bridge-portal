import { parseAbi } from "viem";
import { getDeployment, deploymentArcNetwork } from "../../../config/deployments";
import { evmNetworks } from "../../../config/evm-networks";
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
