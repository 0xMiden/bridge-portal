import type { BitcoinConnector } from "@reown/appkit-adapter-bitcoin";
import { hasTransferAccounts, sameExternalAddress } from "../bridge/core/accounts";
import { isEvmAsset } from "../bridge/core/assets";
import { externalAsset, type BridgeRoute } from "../bridge/core/routes";
import type { TransferSubmission } from "../bridge/core/submission";
import type { EvmProvider } from "./evm/evm-wallet";

export type BitcoinProvider = Pick<BitcoinConnector, "getAccountAddresses" | "sendTransfer"> & {
  /** Bind the reviewed sender before opening the extension's payment prompt. */
  prepareTransfer?: (params: Parameters<BitcoinConnector["sendTransfer"]>[0], reviewedSender: string,
    paymentAccount: BitcoinConnector.AccountAddress) => Promise<() => Promise<string>>;
  type?: string;
  wallet?: { features?: Readonly<Record<string, unknown>> };
  provider?: { session?: { namespaces: Record<string, { methods: string[] }> } };
};

export function supportsBitcoinPayments(provider?: BitcoinProvider): provider is BitcoinProvider {
  if (typeof provider?.sendTransfer !== "function") return false;
  // Reown's Wallet Standard connector exposes a sendTransfer stub.
  if (provider.wallet?.features && "bitcoin:connect" in provider.wallet.features) return false;
  if (provider.type === "WALLET_CONNECT") {
    const methods = provider.provider?.session?.namespaces.bip122?.methods;
    return Boolean(methods?.includes("getAccountAddresses") && methods.includes("sendTransfer"));
  }
  return true;
}

export type ExternalWallet = { connected: boolean; address: string } & (
  | { family: "evm"; provider?: EvmProvider }
  | { family: "bitcoin"; provider?: BitcoinProvider; assertAccount: (address: string) => Promise<BitcoinConnector.AccountAddress> }
);

export function requireEvmWallet(wallet: ExternalWallet) {
  if (wallet.family !== "evm" || !wallet.provider || !wallet.address) throw new Error("Connect your Ethereum wallet.");
  return { provider: wallet.provider, address: wallet.address };
}

export function validateBridgeWallet(route: BridgeRoute, input: TransferSubmission) {
  const { externalWallet: wallet, externalAddress } = input;
  const asset = externalAsset(route);
  if (wallet.family !== (isEvmAsset(asset) ? "evm" : asset.network)) throw new Error("Connect a wallet for the selected network.");
  if (!wallet.connected || !wallet.address || (route.mode === "receive" && !wallet.provider)) return false;
  if (!sameExternalAddress(asset, externalAddress, wallet.address)) throw new Error("Your connected wallet changed. Review the transfer again.");
  if (!hasTransferAccounts(route, input)) throw new Error("Connect a valid wallet address for this network and review again.");
  return true;
}

/** Recheck the recipient account immediately before signing on Miden. */
export async function assertRecipientAccount({ externalWallet: wallet, externalAddress }: TransferSubmission) {
  switch (wallet.family) {
    case "bitcoin": return wallet.assertAccount(externalAddress);
    case "evm": {
      const accounts = await wallet.provider?.request({ method: "eth_accounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || accounts[0].toLowerCase() !== externalAddress.toLowerCase()) {
        throw new Error("Your EVM wallet changed. Reconnect and review the transfer again.");
      }
    }
  }
}
