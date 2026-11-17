"use client";

import { useAppKitAccount, useAppKitProvider, useWalletInfo } from "@reown/appkit/react";
import { bitcoin } from "@reown/appkit/networks";
import { isBitcoinAddress } from "../../bridge/bitcoin/address";
import { appKit } from "../AppKitProvider";
import type { BitcoinProvider } from "../bridge-wallet";

type PaymentAccount = Pick<ReturnType<typeof useAppKitAccount>, "isConnected" | "address" | "caipAddress" | "allAccounts">;

function isMainnetPaymentAccount(account: PaymentAccount | undefined, address: string) {
  return account?.isConnected && account.address === address && isBitcoinAddress(address) &&
    account.caipAddress === `${bitcoin.caipNetworkId}:${address}` &&
    account.allAccounts.some(item => item.address === address && item.type === "payment");
}

export function useBitcoinWallet() {
  const account = useAppKitAccount({ namespace: "bip122" });
  const { walletProvider: provider } = useAppKitProvider<BitcoinProvider>("bip122");
  const { walletInfo: info } = useWalletInfo("bip122");
  const address = account.isConnected ? account.address ?? "" : "";
  const valid = typeof provider?.getAccountAddresses === "function" && isMainnetPaymentAccount(account, address);

  async function assertAccount(reviewedAddress: string) {
    if (!provider?.getAccountAddresses) throw new Error("Connect your Bitcoin wallet before transferring.");
    function checkConnection() {
      if (!isMainnetPaymentAccount(appKit.getAccount("bip122"), reviewedAddress) ||
          appKit.getProvider<BitcoinProvider>("bip122") !== provider) {
        throw new Error("Your Bitcoin wallet changed. Connect a mainnet payment account and review again.");
      }
    }
    checkConnection();
    const addresses = await provider.getAccountAddresses();
    if (addresses.find(item => item.purpose === "payment")?.address !== reviewedAddress) {
      throw new Error("Your Bitcoin payment account changed. Review the transfer again.");
    }
    checkConnection();
  }

  return { connected: account.isConnected, address, provider, info, valid, assertAccount };
}
