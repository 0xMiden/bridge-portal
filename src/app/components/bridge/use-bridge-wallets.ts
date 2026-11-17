import { useState } from "react";
import { useAppKit, useAppKitAccount, useAppKitProvider, useWalletInfo } from "@reown/appkit/react";
import { useEvmBalance, useMidenBalance } from "../../../bridge/BalanceProvider";
import { externalAsset, type BridgeRoute } from "../../../bridge/core/routes";
import { isEvmAsset } from "../../../bridge/core/assets";
import { evmNetworks } from "../../../config/evm-networks";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { useMidenWallet } from "../../../wallets/miden/useMidenWallet";
import { useBitcoinWallet } from "../../../wallets/bitcoin/useBitcoinWallet";
import { bitcoinExplorer } from "../../lib/bridge-presentation";
import { errorMessage } from "../../lib/wallet-errors";

function compactTokenAmount(value: string) {
  if (Number(value) > 0 && Number(value) < 0.0001) return "<0.0001";
  const [whole, fraction = ""] = value.split(".");
  const compactFraction = fraction.slice(0, 4).replace(/0+$/, "");
  return compactFraction ? `${whole}.${compactFraction}` : whole;
}

/** Shared wallet accounts and route balances used by the panels and submission. */
export function useBridgeWallets(route: BridgeRoute) {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount({ namespace: "eip155" });
  const { walletProvider } = useAppKitProvider<EvmProvider>("eip155");
  const { walletInfo } = useWalletInfo("eip155");
  const miden = useMidenWallet();
  const [error, setError] = useState("");
  const bitcoinWallet = useBitcoinWallet();
  const asset = externalAsset(route);
  const evmAddress = isConnected && address ? address : "";
  const midenAccount = miden.connected ? miden.address : "";
  const midenToken = [route.source, route.destination].find(asset => asset.kind === "miden");
  const evmToken = isEvmAsset(asset) ? asset : undefined;
  const midenBalance = useMidenBalance(midenAccount, midenToken);
  const evmBalance = useEvmBalance(evmAddress, evmToken);
  const evmBalanceLabel = evmBalance.balance
    ? `${compactTokenAmount(evmBalance.balance.balance)} ${evmBalance.balance.symbol}` : "";
  const balanceUnavailable = Boolean(evmBalance.error) && !evmBalance.loading;
  const evmBalanceText = evmAddress ? evmBalanceLabel || (balanceUnavailable ? "Balance unavailable" : "Loading balance…") : "Not connected";

  if (!evmToken && asset.network !== "bitcoin") throw new Error("Unsupported wallet network.");
  const external = evmToken ? {
    family: "evm" as const, namespace: "eip155" as const, connected: Boolean(evmAddress), address: evmAddress,
    provider: walletProvider, info: walletInfo, network: evmNetworks[evmToken.network],
    networkLabel: evmNetworks[evmToken.network].name, explorer: evmNetworks[evmToken.network].blockExplorers.default,
    balance: evmBalance, balanceText: evmBalanceText, balanceUnavailable, warning: "",
  } : {
    ...bitcoinWallet, family: "bitcoin" as const, namespace: "bip122" as const,
    networkLabel: "Bitcoin", explorer: bitcoinExplorer, balance: undefined, balanceText: "", balanceUnavailable: false,
    warning: bitcoinWallet.connected && !bitcoinWallet.valid ? "Connect a Bitcoin mainnet payment account." : "",
  };

  async function openExternalWallet() {
    setError("");
    try { await open({ view: "Connect", namespace: external.namespace }); }
    catch (cause) { setError(errorMessage(cause)); }
  }

  return {
    external,
    accounts: { midenAccount, externalAddress: external.family === "bitcoin" && !external.valid ? "" : external.address },
    miden: {
      ...miden, address: midenAccount, balance: midenBalance,
      balanceText: !miden.connected ? "Not connected" : midenBalance.balance && midenToken
        ? `${compactTokenAmount(midenBalance.balance.balance)} ${midenToken.symbol}` : "Syncing…",
    },
    error, setError, openExternalWallet,
  };
}

export type BridgeWallets = ReturnType<typeof useBridgeWallets>;
