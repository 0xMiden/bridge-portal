import { useMemo } from "react";
import type { TransferQuote } from "../../../bridge/core/quote";
import type { BridgeRoute } from "../../../bridge/core/routes";
import { isValidAmount, validateTransferAmount } from "../../../bridge/core/rules";
import { providerFee, quoteFor } from "../../lib/bridge-presentation";
import { useSepoliaGasEstimate } from "../../lib/sepolia-gas";
import { useBalanceCap } from "../../lib/use-balance-cap";
import { useTransferQuote } from "../../lib/use-transfer-quote";
import { errorMessage } from "../../lib/wallet-errors";
import type { BridgeWallets } from "./use-bridge-wallets";

export function useBridgeQuote(route: BridgeRoute, amount: string, wallets: BridgeWallets, review?: { quote?: TransferQuote }) {
  const validation = useMemo(() => {
    try {
      validateTransferAmount(route, amount);
      return { valid: true, error: "" };
    } catch (error) {
      return { valid: false, error: isValidAmount(amount) ? errorMessage(error) : "" };
    }
  }, [route, amount]);
  const estimate = quoteFor(route, amount);
  const { fees } = estimate;
  const query = useTransferQuote({ route, amount, ...wallets.accounts }, Boolean(review));
  const live = review ? review.quote : query.data;
  const gas = useSepoliaGasEstimate(estimate.fees.sepoliaGasUnits, wallets.evm.token?.network ?? "sepolia");
  const balanceCap = useBalanceCap(route, amount, wallets.accounts.midenAccount);
  const capError = balanceCap.enabled && validation.valid && !balanceCap.checking ? balanceCap.error : "";
  const capBlocked = balanceCap.enabled && (balanceCap.checking || Boolean(balanceCap.error));
  const evmBalance = wallets.evm.balance.balance;
  const insufficientBalance = route.mode === "receive" && wallets.evm.connected && Boolean(evmBalance) &&
    Number(amount) > 0 && Number(amount) + (fees.charging === "additional" ? Number(live?.fee ?? 0) : 0) > Number(evmBalance?.balance);

  return {
    estimate, fees, query, live, validation, balanceCap, capError, capBlocked, insufficientBalance,
    amountError: validation.error || capError,
    received: live?.received ?? (query.isFetching ? "…" : estimate.expectedReceived),
    networkFee: gas.fee || (gas.loading ? "Estimating…" : estimate.networkFee),
    fee: live?.fee !== undefined
      ? providerFee(fees, live.fee, route.source.symbol, route.destination.symbol).value
      : query.isFetching ? "Fetching quote…" : estimate.bridgeFee,
  };
}

export type BridgeQuote = ReturnType<typeof useBridgeQuote>;
