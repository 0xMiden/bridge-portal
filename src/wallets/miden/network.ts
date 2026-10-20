import { midenNetworks, type BridgeEnvironment } from "../../config/environment";

/** Check the network before address decoding discards its bech32 prefix. */
export function assertMidenAccountNetwork(address: string, environment: BridgeEnvironment) {
  const normalized = address.trim().toLowerCase();
  // Legacy integrations expose raw testnet account ids. Mainnet requires the
  // network-bearing address returned by current Bread releases.
  if (environment === "testnet" && /^(0x)?[\da-f]{30}$/.test(normalized)) return;
  if (!normalized.startsWith(`${midenNetworks[environment].addressPrefix}1`))
    throw new Error(`Switch Bread to ${environment} and reconnect before transferring.`);
}
