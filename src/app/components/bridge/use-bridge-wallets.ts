import { useState } from "react";
import { useAppKit, useAppKitAccount, useAppKitProvider, useWalletInfo } from "@reown/appkit/react";
import { useEvmBalance, useMidenBalance } from "../../../bridge/BalanceProvider";
import type { BridgeRoute } from "../../../bridge/core/routes";
import { evmNetworks } from "../../../config/evm-networks";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { useMidenWallet } from "../../../wallets/miden/useMidenWallet";
import { errorMessage } from "../../lib/wallet-errors";
import { usePhantomSolana } from "../../../wallets/solana/usePhantomSolana";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import type { SourceIdentity } from "../../../bridge/core/quote";

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
  const solana = usePhantomSolana();
  const [error, setError] = useState("");
  const evmAddress = isConnected && address ? address : "";
  const midenAccount = miden.connected ? miden.address : "";
  const midenToken = [route.source, route.destination].find(asset => asset.kind === "miden");
  const evmToken = [route.source, route.destination].find(asset => asset.kind === "erc20" || asset.kind === "native");
  const deployment = route.helperDeployment;
  const solanaBalance = useQuery({ queryKey: ["solana-balance", deployment?.deploymentId, deployment?.source.network, deployment?.source.mint, solana.address],
    enabled: !!deployment && !!solana.address && route.source.kind === "spl", retry: false, refetchInterval: 15_000,
    queryFn: async () => {
      if (!deployment) throw new Error("Manual Solana deposits are not configured in this build.");
      const [{ createSolanaConnection, assertSolanaGenesis }, { readSolanaBalances }] = await Promise.all([
        import("../../../bridge/solana/rpc"), import("../../../bridge/providers/xreserve/helper-solana")]);
      const connection = createSolanaConnection(deployment);
      await assertSolanaGenesis(connection, deployment);
      return readSolanaBalances(connection, deployment, solana.address);
    } });
  const sourceIdentity: SourceIdentity | undefined = route.source.kind === "spl" ?
    { runtime: "solana", network: route.source.network, address: solana.address } : undefined;
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
    accounts: { evmAddress: route.source.kind === "spl" ? "" : evmAddress, midenAccount, sourceIdentity },
    solana: { ...solana, balance: solanaBalance, balanceText: solanaBalance.data ? `${formatUnits(solanaBalance.data.amount, 6)} USDC · ${formatUnits(solanaBalance.data.lamports, 9)} SOL` : "Balance unavailable" },
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
