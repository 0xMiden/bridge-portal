import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isQuoteReviewable, type TransferQuote } from "../../../bridge/core/quote";
import type { BridgeRoute } from "../../../bridge/core/routes";
import { validateTransferAmount } from "../../../bridge/core/rules";
import type { BridgeEnvironment } from "../../../config/environment";
import { deriveCtaState } from "../../lib/bridge-presentation";
import { preloadBridgeSubmission, submitBridgeTransfer } from "../../lib/bridge-submission";
import { errorMessage } from "../../lib/wallet-errors";
import { useActivityStore } from "../ActivityProvider";
import { useLockNetworkSelection } from "../NetworkProvider";
import { useBridgeQuote } from "./use-bridge-quote";
import type { BridgeWallets } from "./use-bridge-wallets";

export interface ReviewedTransfer {
  route: BridgeRoute;
  amount: string;
  accounts: BridgeWallets["accounts"];
  quote?: TransferQuote;
}

type TransferState =
  | { status: "editing"; error: string }
  | { status: "preparing"; review: ReviewedTransfer; error: string }
  | { status: "reviewing"; review: ReviewedTransfer; error: string }
  | { status: "submitting"; review: ReviewedTransfer; phase: string; error: string };

/** Review and submission share one snapshot; cancelling discards only that snapshot. */
export function useBridgeTransfer(draft: { route: BridgeRoute; amount: string }, wallets: BridgeWallets, environment: BridgeEnvironment) {
  const router = useRouter();
  const activities = useActivityStore();
  const lockNetworkSelection = useLockNetworkSelection();
  const [state, setState] = useState<TransferState>({ status: "editing", error: "" });
  const preparing = useRef<AbortController | null>(null);
  const review = state.status === "editing" ? undefined : state.review;
  const { route, amount } = draft;
  const quote = useBridgeQuote(route, amount, wallets, review);
  const isSubmitting = state.status === "submitting" || state.status === "preparing";
  const { evmAddress, midenAccount } = wallets.accounts;
  const walletsChanged = Boolean(review && (review.accounts.midenAccount !== midenAccount ||
    review.accounts.evmAddress.toLowerCase() !== evmAddress.toLowerCase()));
  const action = deriveCtaState({
    mode: route.mode, amount, sourceTokenSymbol: route.source.symbol,
    sourceConnected: Boolean(route.mode === "receive" ? evmAddress : midenAccount),
    destinationConnected: Boolean(route.mode === "receive" ? midenAccount : evmAddress),
    insufficientBalance: quote.insufficientBalance,
    quoteLoading: quote.providers.loading && !quote.live,
    isSubmitting, submitPhase: state.status === "submitting" ? state.phase : state.status === "preparing" ? "Preparing quote…" : "", evmNetworkLabel: wallets.evm.network.name,
  });
  const cta = action.action === "review" ? {
    ...action,
    label: quote.live ? "Review transfer" : "No quotes available",
    disabled: !quote.live,
    opensReview: Boolean(quote.live),
  } : action;

  useEffect(() => {
    if (Number(amount) > 0) preloadBridgeSubmission(route.provider);
  }, [amount, route.provider]);

  useEffect(() => () => { preparing.current?.abort(); }, [route.id, amount, midenAccount, evmAddress]);

  function setError(error: string) {
    setState(current => ({ ...current, error }));
  }

  async function openReview() {
    if (state.status !== "editing" || preparing.current) return;
    try { validateTransferAmount(route, amount); }
    catch (error) { setError(errorMessage(error)); return; }
    if (quote.capBlocked) {
      setError(quote.balanceCap.checking ? "" : quote.balanceCap.error);
      return;
    }
    if (!isQuoteReviewable(quote.live)) {
      setError("Refresh the quote before reviewing.");
      void quote.providers.refetch();
      return;
    }
    if (route.provider === "near") {
      const controller = new AbortController();
      preparing.current = controller;
      const accounts = { ...wallets.accounts };
      setState({ status: "preparing", review: { route, amount, accounts }, error: "" });
      try {
        const { prepareNearTransfer } = await import("../../../bridge/providers/near/client");
        const prepared = await prepareNearTransfer({ route, amount, ...accounts }, controller.signal);
        controller.signal.throwIfAborted();
        setState({ status: "reviewing", review: { route, amount, accounts, quote: prepared }, error: "" });
      } catch (error) {
        setState({ status: "editing", error: controller.signal.aborted ? "Transfer details changed. Review again." : errorMessage(error) });
      } finally { preparing.current = null; }
      return;
    }
    setState({
      status: "reviewing", error: "",
      review: { route, amount, accounts: wallets.accounts, quote: quote.live },
    });
  }

  function cancelReview() {
    setState(current => current.status === "reviewing" ? { status: "editing", error: "" } : current);
  }

  async function confirmReview() {
    if (state.status !== "reviewing") return;
    if (walletsChanged || quote.capBlocked || state.review.route.id !== route.id || state.review.amount !== amount || !isQuoteReviewable(state.review.quote)) {
      setState({ status: "editing", error: walletsChanged
        ? "Your connected wallet changed. Review the transfer again."
        : quote.capBlocked ? (quote.balanceCap.checking ? "" : quote.balanceCap.error) : "Transfer details changed or the quote expired. Review again." });
      return;
    }
    const reviewed = state.review;
    setState({ status: "editing", error: "" });
    wallets.setError("");
    const midenAsset = wallets.miden.balance.balance;
    const unlockNetworkSelection = lockNetworkSelection();
    try {
      await submitBridgeTransfer({
        routeId: reviewed.route.id, environment, amount: reviewed.amount, quote: reviewed.quote,
        ...reviewed.accounts,
        insufficientBalance: quote.insufficientBalance, evmBalance: wallets.evm.balanceLabel,
        evmWallet: wallets.evm,
        midenWallet: wallets.miden,
        midenAsset: midenAsset && midenAsset.amountRaw > 0n ? midenAsset : null,
      }, {
        openEvmWallet: wallets.openEvmWallet,
        verifyBalanceCap: quote.balanceCap.verifyBalanceCap,
        onError: setError,
        onSubmittingChange: submitting => setState(current => submitting
          ? { status: "submitting", review: reviewed, phase: "", error: current.error }
          : { status: "editing", error: current.error }),
        onPhaseChange: phase => setState(current => current.status === "submitting" ? { ...current, phase } : current),
        activities, navigate: path => router.push(path),
      });
    } finally {
      unlockNetworkSelection();
    }
  }

  async function retryBalanceCap() {
    setError("");
    try { await quote.balanceCap.refresh(); }
    catch (error) { setError(errorMessage(error)); }
  }

  return {
    quote, cta, error: state.error, isSubmitting, walletsChanged,
    review: state.status === "reviewing" ? state.review : undefined,
    openReview, cancelReview, confirmReview, retryBalanceCap, clearError: () => setError(""),
  };
}

export type BridgeTransfer = ReturnType<typeof useBridgeTransfer>;
