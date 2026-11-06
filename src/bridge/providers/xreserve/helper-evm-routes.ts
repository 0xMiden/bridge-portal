import sources from "../../../config/cctp-evm-sources.json";
import { evmHelperDeployments } from "../../../config/cctp-evm-helper";
import type { BridgeConfig } from "../../../config/bridge-config";
import type { BridgeRoute } from "../../core/routes";
import type { BridgeAsset } from "../../core/assets";
import { isEvmNetwork } from "../../../config/evm-networks";
/** Protocol catalog entries are visible but unavailable until independently qualified. */
export function evmHelperRoutes(recovery: BridgeConfig, destination: BridgeAsset): BridgeRoute[] {
  return sources.filter(row => row.environment === recovery.environment && row.domain !== 26).flatMap(row => {
    const network = row.network;
    if (!isEvmNetwork(network)) throw new Error("Unknown CCTP source catalog identity.");
    const deployments = evmHelperDeployments.filter(d => d.environment === recovery.environment && d.source.network === network);
    return (deployments.length ? deployments : [undefined]).map(deployment => ({
      id: `${recovery.environment}:cctp-helper-evm-${network}${deployment ? `:${deployment.deploymentId}` : ""}`,
      provider: "xreserve", mode: "receive", transport: "cctp-helper-evm", execution: "manual", recovery, destination,
      evmHelperDeployment: deployment, disabled: !deployment?.enabled || recovery.document.features.bridgeIn === false,
      source: { kind: "erc20", network, address: row.usdc as `0x${string}`, decimals: 6, symbol: "USDC", name: "Circle USDC", logo: "/asset-logos/usdc.svg" },
    } satisfies BridgeRoute));
  });
}
