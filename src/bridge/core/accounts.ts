import { isBitcoinAddress } from "../bitcoin/address";
import { evmAddressSchema } from "../evm/evm-schema";
import { isEvmAsset, type BridgeAsset } from "./assets";
import { externalAsset, type BridgeRoute } from "./routes";

/** The route identifies the network of the non-Miden account. */
export type TransferAccounts = { midenAccount: string; externalAddress: string };

export function sameExternalAddress(asset: BridgeAsset, left: string, right: string) {
  return isEvmAsset(asset) ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function hasTransferAccounts(route: BridgeRoute, accounts: TransferAccounts): boolean {
  if (!accounts.midenAccount || !accounts.externalAddress) return false;
  const asset = externalAsset(route);
  if (isEvmAsset(asset)) return evmAddressSchema.safeParse(accounts.externalAddress).success;
  return asset.network === "bitcoin" && isBitcoinAddress(accounts.externalAddress);
}

export function sameTransferAccounts(route: BridgeRoute, left: TransferAccounts, right: TransferAccounts): boolean {
  return left.midenAccount === right.midenAccount &&
    sameExternalAddress(externalAsset(route), left.externalAddress, right.externalAddress);
}
