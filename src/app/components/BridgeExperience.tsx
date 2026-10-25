"use client";

import {
  ArrowDownUp,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  LogOut,
  RefreshCcw,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { formatUnits, parseUnits } from "viem";
import { evmNetworks } from "../../config/evm-networks";
import { ensureEvmNetwork } from "../../wallets/evm/ensure-network";
import { useTransferQuote } from "../lib/use-transfer-quote";
import { useBalanceCap } from "../lib/use-balance-cap";
import { isQuoteReviewable, type TransferQuote } from "../../bridge/core/quote";
import {
  evmWalletIdentity,
  shortAddress,
} from "../../wallets/identity";
import {
  deriveCtaState,
  quoteFor,
  providerFee,
  networkLabels,
  statusLabel,
  statusTone,
} from "../lib/bridge-presentation";
import { routesForEnvironment, defaultBridgeRoute, reverseBridgeRoute, type BridgeRoute } from "../../bridge/core/routes";
import { flowModes, isFlowMode, type FlowMode } from "../../bridge/core/models";
import { bridgeProviders, isBridgeProvider } from "../../bridge/providers/registry";
import { activityStartedAt, isValidAmount, routeSwitchChangesAsset, validateTransferAmount } from "../../bridge/core/rules";
import {
  loadStoredMode,
  loadStoredRoute,
  loadStoredRouteId,
  saveStoredMode,
  saveStoredRoute,
} from "../lib/bridge-persistence";
import { preloadBridgeSubmission, submitBridgeTransfer } from "../lib/bridge-submission";
import { errorMessage } from "../lib/wallet-errors";
import { useSepoliaGasEstimate } from "../lib/sepolia-gas";
import { ActivityStack } from "./ActivityStack";
import { InfoTip } from "./InfoTip";
import { RelativeTime } from "./RelativeTime";
import { TokenSelect } from "./TokenSelect";
import { FiatAmount } from "./FiatAmount";
import { NetworkLogo } from "./AssetLogo";
import { ChainSelect } from "./ChainSelect";
import { ProviderOptions } from "./ProviderOptions";
import { WalletMenu } from "../../wallets/WalletMenu";
import { WalletBrandIcon } from "../../wallets/WalletBrandIcon";
import { FaucetMenu } from "./FaucetMenu";
import { useBridgeEnvironment } from "./NetworkProvider";
import { useActivitySnapshot, useActivityStore } from "./ActivityProvider";
import { NetworkSelect } from "./NetworkSelect";
import type { BridgeEnvironment } from "../../config/environment";
import { ThemeToggle } from "./ThemeToggle";
import { useMidenBalance, useEvmBalance } from "../../bridge/BalanceProvider";
import {
  useAppKit,
  useAppKitAccount,
  useAppKitProvider,
  useDisconnect,
  useWalletInfo,
} from "@reown/appkit/react";
import { type EvmProvider } from "../../wallets/evm/evm-wallet";
import { gsap, useGSAP } from "../lib/gsap";
import { EASE, motionMM } from "../lib/motion";
import { useMidenWallet } from "../../wallets/miden/useMidenWallet";

const MOBILE_ROUTE_QUERY = "(max-width: 640px)";

function subscribeToMobileRouteQuery(onChange: () => void) {
  const query = window.matchMedia(MOBILE_ROUTE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getMobileRouteSnapshot() {
  return window.matchMedia(MOBILE_ROUTE_QUERY).matches;
}

function getServerMobileRouteSnapshot() {
  return false;
}

function initialBridgeForm(params: ReadonlyURLSearchParams, environment: BridgeEnvironment) {
  const bridgeRoutes = routesForEnvironment(environment);
  // Providers mounts this form inside the client-only Miden wallet provider.
  // Resolve the launch URL and saved selection before its first render.
  const requestedProvider = params.get("provider");
  const provider =
    isBridgeProvider(requestedProvider) && !bridgeProviders[requestedProvider].disabled
      ? requestedProvider
      : loadStoredRoute(environment) ?? "xreserve";
  const requestedMode = params.get("mode");
  const mode = isFlowMode(requestedMode) ? requestedMode : loadStoredMode(environment) ?? "receive";
  const saved = loadStoredRouteId(environment);
  const route =
    (saved?.provider === provider && saved.mode === mode && !saved.disabled ? saved : undefined) ??
    defaultBridgeRoute(provider, mode, environment) ??
    defaultBridgeRoute(provider, "receive", environment) ??
    bridgeRoutes.find((option) => !option.disabled && !bridgeProviders[option.provider].disabled)!;
  return { route };
}

const MidenWalletButton = dynamic(
  () => import("../../wallets/miden/MidenWalletButton").then(mod => mod.MidenWalletButton),
  {
    ssr: false,
    loading: () => (
      <button className="wallet-button wallet-pill" type="button" disabled>
        <span className="wallet-avatar">
          <span className="wallet-avatar-badge">
            <WalletBrandIcon size={11} />
          </span>
        </span>
        <span className="wallet-pill-label">Loading</span>
      </button>
    ),
  },
);

function compactTokenAmount(value: string) {
  // A nonzero amount below the 4-dp display precision shouldn't read as "0".
  const num = Number(value);
  if (num > 0 && num < 0.0001) return "<0.0001";
  const [whole, fraction = ""] = value.split(".");
  const compactFraction = fraction.slice(0, 4).replace(/0+$/, "");
  return compactFraction ? `${whole}.${compactFraction}` : whole;
}

export function BridgeExperience() {
  const environment = useBridgeEnvironment();
  if (!routesForEnvironment(environment).some(route => !route.disabled)) return (
    <main className="app-shell"><header className="topbar"><h1>Miden Bridge</h1><NetworkSelect /></header>
      <section className="detail-empty"><h2>No routes available</h2><p>New transfers are currently unavailable on {environment}. Existing receipts remain accessible from their saved links.</p></section>
    </main>
  );
  return <BridgeForm key={environment} />;
}

function BridgeForm() {
  const environment = useBridgeEnvironment();
  const mobileRouteSheet = useSyncExternalStore(
    subscribeToMobileRouteQuery,
    getMobileRouteSnapshot,
    getServerMobileRouteSnapshot,
  );
  const router = useRouter();
  const searchParams = useSearchParams();
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<EvmProvider>("eip155");
  const { disconnect } = useDisconnect();
  const { walletInfo } = useWalletInfo("eip155");
  const evmIcon = walletInfo?.icon;
  const [initialForm] = useState(() => initialBridgeForm(searchParams, environment));
  const [route, setRoute] = useState<BridgeRoute>(initialForm.route);
  const { provider, mode } = route;
  const [amount, setAmount] = useState("");
  const [activeTab, setActiveTab] = useState<"bridge" | "activity">("bridge");
  const [providerSelection, setProviderSelection] = useState<"automatic" | "manual">("automatic");
  const walletAccount = address ?? "";
  const walletConnected = isConnected && Boolean(address);
  const externalAsset = route.source.kind === "miden" ? route.destination : route.source;
  const evmNetwork = evmNetworks[externalAsset.kind === "miden" ? "sepolia" : externalAsset.network];
  const midenWallet = useMidenWallet();
  const [walletError, setWalletError] = useState("");
  const [bridgeError, setBridgeError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState("");
  // Preflight review gate: a valid transfer opens this confirmation surface
  // first; the wallet is invoked only from its "Confirm in wallet" action, never
  // straight off the primary CTA. Cancelling just closes it (form state is
  // untouched, so all entered data is preserved).
  const [showPreflight, setShowPreflight] = useState(false);
  const [reviewedQuote, setReviewedQuote] = useState<TransferQuote>();
  const [reviewedAccounts, setReviewedAccounts] = useState<{ evmAddress: string; midenAccount: string }>();
  // Reveals the full destination value in the preflight (a long Miden id / 0x
  // address is shortened by default, with an affordance to inspect it in full).
  const [showFullDestination, setShowFullDestination] = useState(false);
  const [showFullSource, setShowFullSource] = useState(false);
  const [preflightDestinationCopied, setPreflightDestinationCopied] =
    useState(false);
  const walletPanelsRef = useRef<HTMLDivElement>(null);
  const preflightConfirmRef = useRef<HTMLButtonElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const preflightPreviousFocusRef = useRef<HTMLElement | null>(null);
  const activityStore = useActivityStore();
  const { receipts } = useActivitySnapshot();
  const activities = receipts.map(receipt => receipt.activity).filter(activity => activity.environment === environment);
  const [evmMenuOpen, setEvmMenuOpen] = useState(false);
  const [evmCopied, setEvmCopied] = useState(false);
  const evmMenuRef = useRef<HTMLDivElement>(null);
  const [routeMenuOpen, setRouteMenuOpen] = useState(false);
  const routeTriggerRef = useRef<HTMLButtonElement>(null);

  // Tier B: when the mode (Receive/Send) or route changes, the swap boxes and
  // quote summary now update IN PLACE (no more key-based remount + slide). Give
  // the changed CONTENT (not the boxes themselves — fading a box blinks its
  // background) a gentle, slow settle so the whole route's details re-materialise
  // in unison instead of some fading while token icons / amounts snap. Every
  // changed row fades together from a shallow floor, so it reads as smooth rather
  // than a flash. Skips the first mount; reduced-motion → no fade.
  const swapCardRef = useRef<HTMLElement>(null);
  const swapFadeFirstRun = useRef(true);
  useGSAP(
    () => {
      if (swapFadeFirstRun.current) {
        swapFadeFirstRun.current = false;
        return;
      }
      const root = swapCardRef.current;
      if (!root) return;
      motionMM(({ reduced }) => {
        if (reduced) return;
        const targets = root.querySelectorAll(
          ".swap-box > *, .quote-summary > div, .route-disclaimer span",
        );
        gsap.fromTo(
          targets,
          { opacity: 0.6 },
          { opacity: 1, duration: 0.36, ease: EASE.standard, overwrite: true },
        );
      });
    },
    { dependencies: [route.id], scope: swapCardRef },
  );

  const providerCopy = bridgeProviders[provider];
  const amountValidation = useMemo(() => {
    try {
      validateTransferAmount(route, amount);
      return { valid: true, error: "" };
    } catch (error) {
      return { valid: false, error: isValidAmount(amount) ? errorMessage(error) : "" };
    }
  }, [route, amount]);
  const hasRouteAmount = amountValidation.valid;
  const quote = useMemo(
    () => quoteFor(route, amount),
    [amount, route],
  );
  const destinationSymbol = quote.asset;

  // Live Sepolia gas estimate for the network-fee line (real gasPrice * gas
  // limit) where the fee is Sepolia-side; falls back to the route label
  // (e.g. "Miden fee") when the leg's fee isn't on Sepolia.
  const sepoliaGas = useSepoliaGasEstimate(quote.fees.sepoliaGasUnits, externalAsset.kind === "miden" ? "sepolia" : externalAsset.network);
  const networkFeeDisplay = sepoliaGas.fee
    ? sepoliaGas.fee
    : sepoliaGas.loading
      ? "Estimating…"
      : quote.networkFee;

  // Preload the selected provider adapter before the wallet confirmation.
  useEffect(() => {
    if (!(Number(amount) > 0)) return;
    preloadBridgeSubmission(provider);
  }, [amount, provider]);
  // Quotes and transfers always use the current connected wallet accounts.
  const midenAddress = midenWallet.connected ? midenWallet.address : "";
  const evmAddress = walletConnected ? walletAccount : "";
  const midenAccount = midenAddress;
  const balanceCap = useBalanceCap(route, amount, midenAccount);
  const capError = balanceCap.enabled && hasRouteAmount && !balanceCap.checking ? balanceCap.error : "";
  const amountError = amountValidation.error || capError;
  const capBlocked = balanceCap.enabled && (balanceCap.checking || Boolean(balanceCap.error));
  const quoteQuery = useTransferQuote({ route, amount, midenAccount, evmAddress }, showPreflight || isSubmitting);
  const liveQuote = showPreflight || isSubmitting ? reviewedQuote : quoteQuery.data;
  const fees = quote.fees;

  const expectedReceivedAmount = liveQuote?.received ?? (quoteQuery.isFetching ? "…" : quote.expectedReceived);
  const displayMinReceived = quote.minReceived === "Not quoted" ? "Not quoted" : `${quote.minReceived} ${destinationSymbol}`;
  const feeLabel = fees.label;
  const feeDisplay = liveQuote?.fee !== undefined
    ? providerFee(fees, liveQuote.fee, route.source.symbol, route.destination.symbol).value
    : quoteQuery.isFetching ? "Fetching quote…" : quote.bridgeFee;
  const evmWalletLabel = walletInfo?.name ?? evmNetwork.name;
  const midenRouteToken = [route.source, route.destination].find((asset) => asset.kind === "miden");
  const evmRouteToken = [route.source, route.destination].find((asset) => asset.kind !== "miden");
  const midenBalance = useMidenBalance(midenWallet.connected ? midenAddress : "", midenRouteToken);
  const evmTokenBalance = useEvmBalance(walletConnected ? walletAccount : "", evmRouteToken);
  const midenTokenBalance = midenBalance.balance;
  const evmBalance = evmTokenBalance.balance
    ? `${compactTokenAmount(evmTokenBalance.balance.balance)} ${evmTokenBalance.balance.symbol}`
    : "";
  const evmBalanceValue = evmTokenBalance.balance ? Number(evmTokenBalance.balance.balance) : null;
  const evmBalanceUnavailable = Boolean(evmTokenBalance.error) && !evmTokenBalance.loading;
  const evmBalanceText = walletConnected
    ? evmBalance || (evmBalanceUnavailable ? "Balance unavailable" : "Loading balance…")
    : "Not connected";
  const midenAsset = midenTokenBalance && midenTokenBalance.amountRaw > 0n
    ? midenTokenBalance
    : null;
  const midenBalanceText = midenWallet.connected
    ? midenTokenBalance && midenRouteToken
      ? `${compactTokenAmount(midenTokenBalance.balance)} ${midenRouteToken.symbol}`
      : "Syncing…"
    : "Not connected";
  // Chain-specific wallet identity for the header pill + the From/To panels, so
  // each side explicitly names its wallet and shows its connection state.
  const evmIdentity = evmWalletIdentity({
    connected: walletConnected,
    networkLabel: evmNetwork.name,
    address: walletAccount,
  });
  const destinationConnected = mode === "receive" ? Boolean(midenAccount) : Boolean(evmAddress);
  // Receive deposits the source token from the connected Sepolia wallet, so a
  // request above its balance would revert on-chain (MetaMask shows "likely to
  // fail"). Block it in-app before the wallet prompt. Send sources from the
  // (private) Miden balance, which we can't read here, so it isn't guarded.
  const sourceTokenSymbol = route.source.symbol;
  const insufficientBalance =
    mode === "receive" &&
    walletConnected &&
    evmBalanceValue != null &&
    Number(amount) > 0 &&
    Number(amount) + (fees.charging === "additional" ? Number(liveQuote?.fee ?? 0) : 0) > evmBalanceValue;
  const routeNote = quote.warning;
  // The connected wallet on the direction's source side — the guard for whether
  // the CTA should prompt a connection (receive sources from Sepolia, send from
  // the Miden wallet).
  const sourceConnected = mode === "receive" ? Boolean(evmAddress) : Boolean(midenAccount);
  // Keep the reviewed accounts fixed if a wallet changes while review is open.
  const previewSource = mode === "receive"
    ? reviewedAccounts?.evmAddress ?? evmAddress
    : reviewedAccounts?.midenAccount ?? midenAccount;
  const previewDestination =
    mode === "receive"
      ? reviewedAccounts?.midenAccount ?? midenAccount
      : reviewedAccounts?.evmAddress ?? evmAddress;
  const reviewWalletsChanged = reviewedAccounts?.midenAccount !== midenAccount ||
    reviewedAccounts?.evmAddress.toLowerCase() !== evmAddress.toLowerCase();
  const cta = deriveCtaState({
    mode,
    sourceConnected,
    destinationConnected,
    amount,
    sourceTokenSymbol,
    insufficientBalance,
    quoteLoading: quoteQuery.isFetching && !liveQuote,
    isSubmitting,
    submitPhase,
    evmNetworkLabel: evmNetwork.name,
  });

  useEffect(() => {
    saveStoredRoute(initialForm.route.provider, initialForm.route.id, environment);
    saveStoredMode(initialForm.route.mode, environment);
  }, [initialForm, environment]);

  useEffect(() => {
    if (!evmMenuOpen) return;

    function closeMenu(event: MouseEvent | PointerEvent) {
      if (!evmMenuRef.current?.contains(event.target as Node))
        setEvmMenuOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setEvmMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [evmMenuOpen]);

  // The review surface freezes the page behind it. Preserve the
  // complete inline body state and scroll offset so closing (or unmounting)
  // returns the host page to exactly the state in which it was opened.
  useEffect(() => {
    if (!showPreflight) return;
    const body = document.body;
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      width: body.style.width,
      overlayOpen: body.dataset.overlayOpen,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
    body.dataset.overlayOpen = "true";
    body.style.overflow = "hidden";
    if (mobileRouteSheet) {
      body.style.position = "fixed";
      body.style.top = `${-previous.scrollY}px`;
      body.style.left = `${-previous.scrollX}px`;
      body.style.width = "100%";
    }

    return () => {
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.width = previous.width;
      if (previous.overlayOpen === undefined) delete body.dataset.overlayOpen;
      else body.dataset.overlayOpen = previous.overlayOpen;
      if (mobileRouteSheet) window.scrollTo(previous.scrollX, previous.scrollY);
    };
  }, [mobileRouteSheet, showPreflight]);

  function selectMode(nextMode: FlowMode) {
    const nextRoute = nextMode === mode ? route : reverseBridgeRoute(route);
    if (!nextRoute) return;
    setRouteMenuOpen(false);
    setRoute(nextRoute);
    setProviderSelection("automatic");
    // Remember the tab and route so a refresh keeps this direction.
    saveStoredMode(nextMode, environment);
    saveStoredRoute(nextRoute.provider, nextRoute.id, environment);
    setAmount("");
    setBridgeError("");
  }

  // The Sepolia balance line — shown only once the wallet is connected (the chip
  // above owns the disconnected/connecting states).
  function renderEvmBalance() {
    if (!walletConnected) return null;
    if (evmTokenBalance.balance) return <>Available {evmBalanceText}</>;
    if (evmBalanceUnavailable) return <>Balance unavailable</>;
    return (
      <>
        <span aria-hidden="true">Available</span>
        <span className="balance-placeholder" role="status">
          <span className="sr-only">Loading {evmRouteToken?.symbol} balance…</span>
        </span>
      </>
    );
  }

  // The shared session loads balances on connection; failed reads can be retried.
  function renderMidenBalance() {
    // Connection state (not connected / connecting / launch-account) lives in the
    // wallet chip above; the balance line only appears once there's a balance.
    if (!midenWallet.connected) return null;
    if (midenTokenBalance && midenRouteToken) {
      return (
        <>
          Available {midenBalanceText}
          <button
            type="button"
            className="balance-refresh"
            onClick={() => void midenBalance.refresh().catch(() => {})}
            disabled={midenBalance.loading}
            aria-label="Refresh Miden balance"
            title="Refresh Miden balance"
          >
            <RefreshCcw size={12} aria-hidden="true" />
          </button>
        </>
      );
    }
    if (!midenBalance.error) return <>Available Syncing…</>;
    return (
      <button
        type="button"
        className="balance-show"
        onClick={() => void midenBalance.show().catch(() => {})}
      >
        Balance unavailable · Retry
      </button>
    );
  }

  // Only surface transfers that are still in progress — the just-initiated one(s).
  // Completed/failed history isn't shown on the home page (view it via its link).
  const inFlightActivities = activities.filter(
    (a) =>
      a.status !== "complete" &&
      a.status !== "failed" &&
      // Drop orphaned "Needs signature" rows that never broadcast a source tx.
      // Unsigned attempts have no transaction to track after leaving the form.
      !(a.status === "signature" && !a.sourceTxHash),
  );

  // Settled transfers (complete/failed), newest first — a persisted history that
  // survives refresh from localStorage so users keep a record of past bridging.
  // Capped so the list stays glanceable; the full set remains in storage.
  const pastActivities = activities
    .filter((a) => a.status === "complete" || a.status === "failed")
    .slice(0, 12);

  function selectRoute(nextRoute: BridgeRoute) {
    if (nextRoute.disabled || bridgeProviders[nextRoute.provider].disabled || nextRoute.id === route.id) return;
    if (routeSwitchChangesAsset(route, nextRoute)) {
      setAmount("");
    }
    setRouteMenuOpen(false);
    setRoute(nextRoute);
    setProviderSelection("automatic");
    saveStoredRoute(nextRoute.provider, nextRoute.id, environment);
    setBridgeError("");
  }

  function selectRouteOption(nextRoute: BridgeRoute) {
    selectRoute(nextRoute);
    setProviderSelection("manual");
    closeRouteMenu();
  }

  function closeRouteMenu(restoreFocus = true) {
    setRouteMenuOpen(false);
    if (restoreFocus)
      window.requestAnimationFrame(() => routeTriggerRef.current?.focus());
  }

  async function openWalletModal() {
    setWalletError("");
    try {
      await open();
    } catch (error) {
      setWalletError(errorMessage(error));
    }
  }

  async function openWalletPermissions() {
    setWalletError("");
    setEvmMenuOpen(false);
    try {
      await open({ view: "Account" });
    } catch (error) {
      setWalletError(errorMessage(error));
    }
  }

  async function copyEvmAddress() {
    if (!walletAccount) return;

    try {
      await navigator.clipboard.writeText(walletAccount);
      setEvmCopied(true);
      window.setTimeout(() => setEvmCopied(false), 1400);
    } catch {
      setWalletError("Could not copy the wallet address from this browser.");
    }
  }

  async function forgetEvmWallet() {
    setEvmMenuOpen(false);
    setWalletError("");
    try {
      await disconnect();
    } catch {
      // Ignore disconnect failures; account state is driven by AppKit hooks.
    }
  }

  async function switchEvmFromMenu() {
    setEvmMenuOpen(false);
    setWalletError("");
    try {
      if (!walletProvider) throw new Error(`Connect your ${evmNetwork.name} wallet first.`);
      await ensureEvmNetwork(walletProvider, evmNetwork);
    } catch (error) {
      setWalletError(errorMessage(error));
    }
  }

  async function handleEvmWalletClick() {
    if (walletConnected) {
      setEvmMenuOpen((isOpen) => !isOpen);
      return;
    }

    await openWalletModal();
  }

  // Focus the actual Miden control inside its panel; do not create a second
  // wallet adapter instance when the transfer direction changes.
  function connectMidenWallet() {
    const midenPill = walletPanelsRef.current?.querySelector<HTMLButtonElement>(
      '[data-wallet="miden"] .wallet-pill',
    );
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    midenPill?.scrollIntoView({
      block: "center",
      behavior: reducedMotion ? "auto" : "smooth",
    });
    midenPill?.focus();
    midenPill?.click();
  }

  // The CTA never submits directly: it either advances the form (connect the
  // missing wallet) or opens the preflight review. Only
  // the review's confirm action reaches submitTransfer.
  function handlePrimaryAction() {
    switch (cta.action) {
      case "connect-source":
        if (mode === "receive") void openWalletModal();
        else connectMidenWallet();
        return;
      case "connect-destination":
        if (mode === "receive") connectMidenWallet();
        else void openWalletModal();
        return;
      case "review":
        setBridgeError("");
        try { validateTransferAmount(route, amount); }
        catch (error) { setBridgeError(errorMessage(error)); return; }
        if (capBlocked) {
          setBridgeError(balanceCap.checking ? "" : balanceCap.error);
          return;
        }
        if (fees.requiresQuote) {
          if (!isQuoteReviewable(quoteQuery.data)) {
            setBridgeError(quoteQuery.error ? errorMessage(quoteQuery.error) : "Refresh the quote before reviewing.");
            void quoteQuery.refetch();
            return;
          }
          setReviewedQuote(quoteQuery.data);
        } else setReviewedQuote(undefined);
        setReviewedAccounts({ evmAddress, midenAccount });
        setShowFullDestination(false);
        setShowFullSource(false);
        setPreflightDestinationCopied(false);
        preflightPreviousFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : primaryActionRef.current;
        setShowPreflight(true);
        return;
      default:
        // Disabled states (enter-amount, insufficient, quote-loading,
        // submitting) can't advance — the button is disabled, so this is a no-op.
        return;
    }
  }

  function cancelPreflight() {
    // Close the review with all entered data intact (form state is untouched).
    setShowPreflight(false);
    const focusTarget =
      preflightPreviousFocusRef.current ?? primaryActionRef.current;
    window.requestAnimationFrame(() => focusTarget?.focus());
  }

  function confirmPreflight() {
    setShowPreflight(false);
    if (reviewWalletsChanged) {
      setBridgeError("Your connected wallet changed. Review the transfer again.");
      return;
    }
    if (capBlocked) {
      setBridgeError(balanceCap.checking ? "" : balanceCap.error);
      return;
    }
    void submitTransfer();
  }

  async function copyPreflightDestination() {
    try {
      await navigator.clipboard.writeText(previewDestination);
      setPreflightDestinationCopied(true);
      window.setTimeout(() => setPreflightDestinationCopied(false), 2_000);
    } catch {
      // Clipboard access may be blocked. Keep the action available for retry.
    }
  }

  // While the preflight is open, focus its confirm action and let Escape cancel
  // it — keyboard parity with the rest of the flow.
  useEffect(() => {
    if (!showPreflight) return;
    const focusFrame = window.requestAnimationFrame(() =>
      preflightConfirmRef.current?.focus(),
    );

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") cancelPreflight();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showPreflight]);

  function handlePreflightKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function submitTransfer() {
    setBridgeError("");
    setWalletError("");
    return submitBridgeTransfer(
      {
        routeId: route.id,
        environment,
        quote: reviewedQuote,
        amount,
        insufficientBalance,
        evmBalance,
        evmWallet: {
          connected: walletConnected,
          address: walletAccount,
          provider: walletProvider,
        },
        midenWallet: {
          connected: midenWallet.connected,
          address: midenAddress,
          requestTransaction: midenWallet.requestTransaction,
          waitForTransaction: midenWallet.waitForTransaction,
        },
        midenAsset,
        evmAddress,
        midenAccount,
      },
      {
        openEvmWallet: open,
        verifyBalanceCap: balanceCap.verifyBalanceCap,
        onError: setBridgeError,
        onSubmittingChange: setIsSubmitting,
        onPhaseChange: setSubmitPhase,
        activities: activityStore,
        navigate: (path) => router.push(path),
      },
    );
  }

  const evmWalletControl = (
          <div className="wallet-menu-root" ref={evmMenuRef}>
            <button
              className={`wallet-button wallet-pill ${walletConnected ? "connected" : ""}`}
              type="button"
              onClick={handleEvmWalletClick}
              aria-expanded={walletConnected ? evmMenuOpen : undefined}
              aria-haspopup={walletConnected ? "menu" : undefined}
              aria-label={evmIdentity.actionLabel}
            >
              <WalletBrandIcon src={walletConnected ? evmIcon : undefined} size={18} />
              <span className="wallet-pill-label">{walletConnected ? evmIdentity.pillLabel : "Connect wallet"}</span>
              {walletConnected ? (
                <ChevronDown
                  className="wallet-menu-chevron"
                  size={15}
                  aria-hidden="true"
                />
              ) : null}
            </button>

            {walletConnected ? (
              <WalletMenu
                open={evmMenuOpen}
                avatar={
                  <span className="wallet-menu-avatar connected">
                    <WalletBrandIcon src={evmIcon} size={20} />
                  </span>
                }
                name={evmWalletLabel}
                subtitle={
                  <>
                    {shortAddress(walletAccount)} · {evmBalanceText}
                  </>
                }
              >
                <button
                  type="button"
                  role="menuitem"
                  className="wallet-menu-item"
                  onClick={openWalletPermissions}
                >
                  <RefreshCcw size={15} aria-hidden="true" />
                  <span>Account permissions</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="wallet-menu-item"
                  onClick={switchEvmFromMenu}
                >
                  <RefreshCcw size={15} aria-hidden="true" />
                  <span>Switch to {evmNetwork.name}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="wallet-menu-item"
                  onClick={copyEvmAddress}
                >
                  <Copy size={15} aria-hidden="true" />
                  <span>{evmCopied ? "Copied" : "Copy address"}</span>
                </button>
                <a
                  role="menuitem"
                  className="wallet-menu-item"
                  href={`${evmNetwork.blockExplorers.default.url}/address/${walletAccount}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={15} aria-hidden="true" />
                  <span>View on {evmNetwork.blockExplorers.default.name}</span>
                </a>
                <span className="wallet-menu-separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="wallet-menu-item danger"
                  onClick={forgetEvmWallet}
                >
                  <LogOut size={15} aria-hidden="true" />
                  <span>Forget in app</span>
                </button>
              </WalletMenu>
            ) : null}
          </div>
  );

  return (
    <main className="app-shell bridge-portal">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Miden bridge home">
          <Image
            src="/miden-logo-horizontal.svg"
            alt="Miden"
            width={112}
            height={34}
            priority
          />
          <span>Bridge</span>

        </Link>

        <div className="topbar-actions">
          <div className="topbar-utilities">
            <NetworkSelect disabled={isSubmitting} />
            {environment === "testnet" ? <FaucetMenu /> : null}
            <ThemeToggle />
          </div>

        </div>
      </header>
      {midenWallet.error ? (
        <p className="form-error topbar-error" role="alert">{errorMessage(midenWallet.error)}</p>
      ) : null}

      <section className="swap-stage">
        <div className="swap-group">
        <h1 className="sr-only">Miden Bridge</h1>
        <div className="bridge-tabs" role="tablist" aria-label="Bridge portal">
          {(["bridge", "activity"] as const).map((tab) => (
            <button
              key={tab}
              id={`${tab}-tab`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls={`${tab}-panel`}
              tabIndex={activeTab === tab ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? "bridge" : event.key === "End" ? "activity" : tab === "bridge" ? "activity" : "bridge";
                setActiveTab(next);
                document.getElementById(`${next}-tab`)?.focus();
              }}
            >
              {tab === "bridge" ? "Bridge" : "Activity"}
              {tab === "activity" && inFlightActivities.length > 0 ? <span className="activity-count">{inFlightActivities.length}</span> : null}
            </button>
          ))}
        </div>
        <div id="bridge-panel" role="tabpanel" aria-labelledby="bridge-tab" hidden={activeTab !== "bridge"} className="bridge-tab-panel">
        <section className="swap-card" data-provider={provider} aria-label="Miden bridge" ref={swapCardRef}>
          {walletError ? (
            <p className="form-error compact" role="alert">{walletError}</p>
          ) : null}

          <div
            className="mode-switch"
            role="group"
            aria-label="Cross-chain direction"
            data-active={mode}
          >
            {flowModes.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={item === mode}
                disabled={item !== mode && !reverseBridgeRoute(route)}
                title={item !== mode && !reverseBridgeRoute(route) ? providerCopy.unavailableReason : undefined}
                onClick={() => selectMode(item)}
              >
                {item === "receive" ? "Deposit" : "Withdraw"}
              </button>
            ))}
          </div>

          <div className="swap-panels" ref={walletPanelsRef}>
            {(["source", "destination"] as const).map((side) => {
              const isSource = side === "source";
              const isMiden = route[side].kind === "miden";
              // Keys follow the wallet, so reversing the route moves the mounted
              // controls rather than disconnecting/reinitializing their adapters.
              return (
                <div className="swap-box" key={isMiden ? "miden" : "evm"} data-side={side}>
                  <div className="swap-box-head">
                    <span>{isSource ? "From" : "To"}</span>
                    <ChainSelect route={route} side={side} onSelectRoute={selectRoute} />
                  </div>
                  <div className="panel-wallet" data-wallet={isMiden ? "miden" : "evm"}>
                    {isMiden ? <MidenWalletButton /> : evmWalletControl}
                  </div>
                  {isSource ? (
                    <label className="swap-box-amount">
                      <input aria-label="Amount" aria-invalid={Boolean(amountError)}
                        aria-describedby={amountError ? "amount-error" : undefined}
                        inputMode="decimal" placeholder="0" value={amount}
                        onChange={(event) => { setAmount(event.target.value); setBridgeError(""); setRouteMenuOpen(false); }} />
                    </label>
                  ) : (
                    <div className="readonly-amount swap-box-amount" aria-label="Expected received">
                      <strong>{expectedReceivedAmount}</strong>
                    </div>
                  )}
                  <div className="swap-box-token">
                    <TokenSelect route={route} side={side} onSelectRoute={selectRoute} />
                  </div>
                  <div className="swap-box-foot">
                    <FiatAmount amount={isSource ? amount : expectedReceivedAmount} symbol={route[side].symbol} />
                    <small className="balance-line">{isMiden ? renderMidenBalance() : renderEvmBalance()}</small>
                  </div>
                  {isSource ? (
            <button className="swap-divider" type="button" aria-label="Reverse transfer direction"
              disabled={!reverseBridgeRoute(route)}
              title={!reverseBridgeRoute(route) ? providerCopy.unavailableReason : "Reverse transfer direction"}
              onClick={() => selectMode(mode === "receive" ? "send" : "receive")}>
              <ArrowDownUp size={20} aria-hidden="true" />
            </button>
                  ) : null}
                </div>
              );
            })}

          </div>

          {amountError ? <p id="amount-error" className="form-error" role="alert">{amountError}</p>
            : bridgeError || quoteQuery.error ? <p className="form-error" role="alert">{bridgeError || errorMessage(quoteQuery.error)}</p> : null}
          {balanceCap.enabled && !balanceCap.checking && balanceCap.status === "unavailable" && hasRouteAmount ? <div id="balance-cap-status" className="balance-cap-status">
            <button
              type="button" className="balance-cap-retry"
              onClick={() => { setBridgeError(""); void balanceCap.refresh().catch(error => setBridgeError(errorMessage(error))); }}
            >Retry balance check</button>
          </div> : null}

        </section>
        <section className="transfer-route-card" data-provider={provider} data-has-amount={hasRouteAmount} aria-label="Transfer route">
          <div className="transfer-route-details" hidden={!hasRouteAmount}>
            <h2>Your route</h2>
            <div className="transfer-route-heading">
              <div className="provider-identity">
                <strong className="selected-provider">{providerCopy.label}</strong>
                <span className="route-pill selection-badge">{providerSelection === "automatic" ? "Automatic" : "Manual"}</span>
              </div>
              <button
                className="route-trigger"
                type="button"
                ref={routeTriggerRef}
                aria-expanded={routeMenuOpen && hasRouteAmount}
                aria-controls="bridge-route-options"
                onClick={() => setRouteMenuOpen((open) => !open)}
              >
                {routeMenuOpen ? "Close" : "Change"}
              </button>
            </div>
            <div className="route-received" aria-label="Route received amount">{expectedReceivedAmount} <span>{destinationSymbol}</span></div>
            <div
              id="bridge-route-options"
              className="transfer-route-options"
              role="group"
              aria-label="Compatible providers"
              hidden={!routeMenuOpen}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeRouteMenu();
                }
              }}
            >
              <ProviderOptions route={route} amount={amount} received={expectedReceivedAmount} fee={feeDisplay} onSelect={selectRouteOption} />
            </div>

          <div className="route-footer">
          <div className="quote-summary" aria-label="Route quote">
            {fees.charging === "additional" || fees.charging === "deducted" ? <div><span>{feeLabel}</span><strong>{feeDisplay}</strong></div> : null}
            {fees.showEta ? <div>
              <span>ETA</span>
              <strong>{quote.eta}</strong>
            </div> : null}
            <div>
              <span>Network fee</span>
              <strong>{networkFeeDisplay}</strong>
            </div>
          </div>
          <div className="route-context">
            <span>{providerSelection === "manual" ? "Selected by you" : "Selected automatically"}</span>
            <InfoTip label={routeNote} />
          </div>
          </div>
          </div>
          <div className="primary-action-dock">
            <button
              className="primary-button"
              type="button"
              ref={primaryActionRef}
              onClick={handlePrimaryAction}
              disabled={cta.disabled || Boolean(amountValidation.error) || (cta.action === "review" && capBlocked)}
            >
              {cta.action === "review" ? "Review transfer" : cta.label}
              {isSubmitting ? (
                <RefreshCcw
                  size={18}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : null}
            </button>
          </div>
          {showPreflight ? (
            <div
              className="preflight-overlay"
              role="dialog"
              aria-modal="true"
              aria-label={`Review ${mode === "receive" ? "receive" : "send"}`}
              onKeyDown={handlePreflightKeyDown}
              onClick={(event) => {
                // A backdrop click cancels; clicks inside the panel don't bubble.
                if (event.target === event.currentTarget) cancelPreflight();
              }}
            >
              <div className="preflight-panel">
                <div className="preflight-head">
                  <span className="preflight-head-title">
                    Review transfer
                    <span className="preflight-testnet">{environment === "mainnet" ? "Mainnet" : "Testnet"}</span>
                  </span>
                  <button
                    type="button"
                    className="preflight-close preflight-cancel"
                    onClick={cancelPreflight}
                    aria-label="Cancel review"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>

                <div className="preflight-body">
                  <div className="preflight-amount">
                    <span className="preflight-quantity">{amount} <span>{route.source.symbol}</span></span>
                    <FiatAmount amount={amount} symbol={route.source.symbol} />
                  </div>

                  <div className="preflight-path">
                    {(["source", "destination"] as const).map((side) => {
                      const isSource = side === "source";
                      const account = isSource ? previewSource : previewDestination;
                      const expanded = isSource ? showFullSource : showFullDestination;
                      return (
                        <div className="preflight-stop" key={side}>
                          <NetworkLogo network={route[side].network} />
                          <div className="preflight-stop-content">
                            <strong>{networkLabels[route[side].network]}</strong>
                            <div className="preflight-address">
                              <span>{isSource ? "From" : "To"}</span>
                              <button
                                type="button"
                                id={`preflight-${side}-value`}
                                className="preflight-account"
                                title={account}
                                aria-label={`${expanded ? "Hide" : "Show full"} ${side} address: ${account}`}
                                aria-expanded={expanded}
                                onClick={() => isSource ? setShowFullSource(!expanded) : setShowFullDestination(!expanded)}
                              >
                                {expanded ? account : shortAddress(account)}
                              </button>
                              {!isSource ? (
                                <button type="button" className="preflight-copy" aria-label={preflightDestinationCopied ? "Destination copied" : "Copy destination"} onClick={copyPreflightDestination}>
                                  {preflightDestinationCopied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <dl className="preflight-rows">
                  {route.source.symbol !== destinationSymbol || Number(amount) !== Number(expectedReceivedAmount) ? <div>
                    <dt>{fees.estimated ? "Estimated received" : "You receive"}</dt>
                    <dd>{expectedReceivedAmount} {destinationSymbol}</dd>
                  </div> : null}
                  {quote.minReceived !== "Not quoted" && Number(quote.minReceived) !== Number(expectedReceivedAmount) ? <div>
                    <dt>Minimum received</dt>
                    <dd>{displayMinReceived}</dd>
                  </div> : null}
                  <div>
                    <dt>Provider</dt>
                    <dd>{providerCopy.label}</dd>
                  </div>
                  {fees.showEta ? <div>
                    <dt>Estimated time</dt>
                    <dd>{quote.eta}</dd>
                  </div> : null}
                  <div>
                    <dt>Network fee</dt>
                    <dd>{networkFeeDisplay}</dd>
                  </div>
                  <div>
                    <dt>{feeLabel}</dt>
                    <dd>{feeDisplay}</dd>
                  </div>
                  {fees.charging === "additional" && liveQuote?.fee !== undefined && Number(liveQuote.fee) > 0 ? <div><dt>Total {route.source.symbol}</dt><dd>{formatUnits(parseUnits(amount, route.source.decimals) + parseUnits(liveQuote.fee, route.source.decimals), route.source.decimals)} {route.source.symbol}</dd></div> : null}
                  </dl>

                  {provider === "xreserve" ? <p className="preflight-note">{routeNote}</p> : null}
                  {reviewWalletsChanged ? <p className="form-error" role="alert">Your connected wallet changed. Close this review and review the transfer again.</p> : null}
                  {capError ? <p className="form-error" role="alert">{capError}</p> : null}
                </div>

                <div className="preflight-actions">
                  <button
                    type="button"
                    className="primary-button preflight-confirm"
                    ref={preflightConfirmRef}
                    disabled={reviewWalletsChanged || capBlocked}
                    onClick={confirmPreflight}
                  >
                    Confirm in wallet
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        </div>
        <div id="activity-panel" role="tabpanel" aria-labelledby="activity-tab" hidden={activeTab !== "activity"} className="activity-tab-panel">
          <div className="activity-region">
            {inFlightActivities.length === 0 && pastActivities.length === 0 ? (
              <div className="activity-empty">
                <h2>No transfers yet</h2>
                <p>Your current and past transfers will appear here.</p>
                <button className="secondary-button" type="button" onClick={() => { setActiveTab("bridge"); document.getElementById("bridge-tab")?.focus(); }}>Make a transfer</button>
              </div>
            ) : null}
            {/* Live transfers stay as prominent standalone rows (they're what
                you're waiting on); settled history collapses into the stack. */}
            {inFlightActivities.length > 0 && (
              <section className="home-activity" aria-label="Current transfer">
                <div className="home-activity-title">
                  <h2>Current transfer</h2>
                </div>
                <div className="home-activity-list">
                  {inFlightActivities.map((activity) => (
                    <Link
                      className="home-activity-item"
                      href={`/activity/${encodeURIComponent(activity.id)}`}
                      key={encodeURIComponent(activity.id)}
                    >
                      <span
                        className={`status-dot ${statusTone(activity.status, activity)}`}
                      />
                      <span className="activity-copy">
                        <strong>{activity.summary}</strong>
                        <small>
                          {bridgeProviders[activity.provider].label} -{" "}
                          {statusLabel(activity.status, activity)}
                        </small>
                      </span>
                      <span className="activity-meta">
                        <strong>
                          {activity.amount} {activity.asset}
                        </strong>
                        <small><RelativeTime at={activityStartedAt(activity)} /></small>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <ActivityStack
              activities={pastActivities}
              title="Recent transfers"
            />
          </div>
        </div>
        </div>
      </section>
    </main>
  );
}
