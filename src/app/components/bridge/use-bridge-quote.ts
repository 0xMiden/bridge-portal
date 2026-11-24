import { useMemo } from "react";
import type { TransferQuote } from "../../../bridge/core/quote";
import { externalAsset, type BridgeRoute } from "../../../bridge/core/routes";
import { isEvmAsset } from "../../../bridge/core/assets";
import { isValidAmount, validateTransferAmount } from "../../../bridge/core/rules";
import { providerFee, quoteFor } from "../../lib/bridge-presentation";
import { useSepoliaGasEstimate } from "../../lib/sepolia-gas";
import { useMidenGasEstimate } from "../../lib/miden-gas";
import { useBalanceCap } from "../../lib/use-balance-cap";
import { useTransferQuotes } from "../../lib/use-transfer-quote";
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
  const providers = useTransferQuotes({ route, amount, ...wallets.accounts }, Boolean(review));
  const { query } = providers;
  const live = review ? review.quote : providers.offers.find(offer => offer.route.id === route.id)?.quote;
  const asset = externalAsset(route);
  const gas = useSepoliaGasEstimate(estimate.fees.sepoliaGasUnits, isEvmAsset(asset) ? asset.network : undefined);
  const midenGas = useMidenGasEstimate(route.recovery,
    validation.valid && route.mode === "send" && (route.provider === "xreserve" || route.provider === "epoch" || route.provider === "near"));
  const balanceCap = useBalanceCap(route, amount, wallets.accounts.midenAccount);
  const capError = balanceCap.enabled && validation.valid && !balanceCap.checking ? balanceCap.error : "";
  const capBlocked = balanceCap.enabled && (balanceCap.checking || Boolean(balanceCap.error));
  const balance = wallets.external.balance?.balance;
  const insufficientBalance = route.mode === "receive" && wallets.external.connected && Boolean(balance) &&
    Number(amount) > 0 && Number(amount) + (fees.charging === "additional" ? Number(live?.fee ?? 0) : 0) > Number(balance?.balance);

  return {
    estimate, fees, query, live, providers, validation, balanceCap, capError, capBlocked, insufficientBalance,
    amountError: validation.error || capError,
    received: live?.received ?? (providers.loading ? "…" : "—"),
    networkFee: midenGas ?? (gas.fee || (gas.loading ? "Estimating…" : estimate.networkFee)),
    fee: live?.fee !== undefined
      ? providerFee(fees, live.fee, route.source.symbol, route.destination.symbol).value
      : query?.isFetching ? "Fetching quote…" : estimate.bridgeFee,
  };
}

export type BridgeQuote = ReturnType<typeof useBridgeQuote>;
