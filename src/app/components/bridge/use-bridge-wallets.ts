import { useState } from "react";
import { useAppKit, useAppKitAccount, useAppKitProvider, useWalletInfo } from "@reown/appkit/react";
import { useEvmBalance, useMidenBalance } from "../../../bridge/BalanceProvider";
import type { BridgeRoute } from "../../../bridge/core/routes";
import { evmNetworks } from "../../../config/evm-networks";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { useMidenWallet } from "../../../wallets/miden/useMidenWallet";
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
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<EvmProvider>("eip155");
  const { walletInfo } = useWalletInfo("eip155");
  const miden = useMidenWallet();
  const [error, setError] = useState("");
  const evmAddress = isConnected && address ? address : "";
  const midenAccount = miden.connected ? miden.address : "";
  const midenToken = [route.source, route.destination].find(asset => asset.kind === "miden");
  const evmToken = [route.source, route.destination].find(asset => asset.kind !== "miden");
  const midenBalance = useMidenBalance(midenAccount, midenToken);
  const evmBalance = useEvmBalance(evmAddress, evmToken);
  const evmBalanceLabel = evmBalance.balance
    ? `${compactTokenAmount(evmBalance.balance.balance)} ${evmBalance.balance.symbol}` : "";
  const balanceUnavailable = Boolean(evmBalance.error) && !evmBalance.loading;

  async function openEvmWallet() {
    setError("");
    try { await open(); }
    catch (cause) { setError(errorMessage(cause)); }
  }

  return {
    accounts: { evmAddress, midenAccount },
    evm: {
      connected: Boolean(evmAddress), address: evmAddress, provider: walletProvider,
      network: evmNetworks[evmToken?.network ?? "sepolia"], info: walletInfo,
      balance: evmBalance, balanceLabel: evmBalanceLabel, balanceUnavailable,
      balanceText: evmAddress ? evmBalanceLabel || (balanceUnavailable ? "Balance unavailable" : "Loading balance…") : "Not connected",
      token: evmToken,
    },
    miden: {
      ...miden, address: midenAccount, balance: midenBalance,
      balanceText: !miden.connected ? "Not connected" : midenBalance.balance && midenToken
        ? `${compactTokenAmount(midenBalance.balance.balance)} ${midenToken.symbol}` : "Syncing…",
    },
    error, setError, openEvmWallet,
  };
}

export type BridgeWallets = ReturnType<typeof useBridgeWallets>;
