"use client";

import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  LogOut,
  RefreshCcw,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { formatUnits } from "viem";
import { evmNetworks } from "../../config/evm-networks";
import { ensureEvmNetwork } from "../../wallets/evm/ensure-network";
import { isCctpNetwork } from "../../bridge/providers/xreserve/cctp-config";
import type { CctpQuote } from "../../bridge/providers/xreserve/cctp-quote";
import { useCctpQuote } from "../lib/use-cctp-quote";
import {
  type WalletIdentity,
  evmWalletIdentity,
  midenWalletIdentity,
  shortAddress,
  walletGradient,
} from "../../wallets/identity";
import { parseArcAmount } from "../../bridge/providers/xreserve/deposit";
import {
  type Activity,
  deriveCtaState,
  modes,
  providers,
  quoteFor,
  networkLabels,
  sourceAssetLabel,
  statusLabel,
  statusTone,
} from "../lib/bridge-presentation";
import { bridgeRoutes, defaultBridgeRoute, reverseBridgeRoute, type BridgeRoute } from "../../bridge/core/routes";
import type { BridgeProvider, FlowMode } from "../../bridge/core/models";
import { activityStartedAt, routeSwitchChangesAsset } from "../../bridge/core/rules";
import {
  loadStoredActivities,
  loadStoredMode,
  loadStoredRoute,
  loadStoredRouteId,
  saveActivities,
  saveStoredMode,
  saveStoredRoute,
} from "../lib/bridge-persistence";
import { preloadBridgeSubmission, submitBridgeTransfer } from "../lib/bridge-submission";
import { errorMessage } from "../lib/wallet-errors";
import { sepoliaGasUnitsFor, useSepoliaGasEstimate } from "../lib/sepolia-gas";
import { ActivityStack } from "./ActivityStack";
import { InfoTip } from "./InfoTip";
import { RelativeTime } from "./RelativeTime";
import { TokenSelect } from "./TokenSelect";
import { ChainSelect } from "./ChainSelect";
import { WalletMenu } from "../../wallets/WalletMenu";
import { FaucetMenu } from "./FaucetMenu";
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
// Type-only import — erased at build, so the eager-WASM adapter never reaches SSR.
import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";

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

/** The connected wallet's own brand logo, or a neutral wallet fallback. */
function WalletBrandIcon({ src, size }: { src?: string; size: number }) {
  if (!src) return <Wallet size={size} aria-hidden="true" />;
  const s = { width: size, height: size, borderRadius: 5, display: "block" };
  // eslint-disable-next-line @next/next/no-img-element -- data-URI wallet logo, not an optimizable asset
  return <img src={src} alt="" style={s} />;
}

type MidenWalletSnapshot = {
  address: string;
  connected: boolean;
  connecting: boolean;
  ready: boolean;
  error: string;
  balanceText: string;
  noteSyncStatus: string;
  consumableNoteCount: number | null;
  requestSend?: MidenFiWalletContextState["requestSend"];
  requestTransaction?: MidenFiWalletContextState["requestTransaction"];
  waitForTransaction?: MidenFiWalletContextState["waitForTransaction"];
  requestConsumableNotes?: MidenFiWalletContextState["requestConsumableNotes"];
};

const emptyMidenWallet: MidenWalletSnapshot = {
  address: "",
  connected: false,
  connecting: false,
  // Default ready=true so the panel reads a neutral "Not connected" before the
  // (dynamically imported) adapter reports; it corrects to "Not installed" only
  // once the button confirms the extension is genuinely missing.
  ready: true,
  error: "",
  balanceText: "Not connected",
  noteSyncStatus: "Not connected",
  consumableNoteCount: null,
};

function providerFromParam(value: string | null): BridgeProvider | null {
  if (value === "near-intents" || value === "agglayer" || value === "epoch" || value === "xreserve")
    return value;
  return null;
}

function modeFromIntent(value: string | null): FlowMode | null {
  if (value === "receive" || value === "deposit") return "receive";
  if (value === "send" || value === "withdraw") return "send";
  return null;
}

function initialBridgeForm(params: ReadonlyURLSearchParams) {
  // Providers mounts this form inside the client-only Miden wallet provider.
  // Resolve the launch URL and saved selection before its first render.
  const requestedProvider = providerFromParam(params.get("provider") ?? params.get("route"));
  const provider = requestedProvider && !providers[requestedProvider].disabled
    ? requestedProvider
    : loadStoredRoute() ?? "epoch";
  const mode = modeFromIntent(params.get("intent") ?? params.get("mode")) ?? loadStoredMode() ?? "receive";
  const saved = loadStoredRouteId();
  const route = (saved?.provider === provider && saved.mode === mode ? saved : undefined) ?? defaultBridgeRoute(provider, mode) ?? defaultBridgeRoute(provider, "receive") ?? bridgeRoutes[0];
  const midenAccount = params.get("midenAccount") ?? params.get("miden_account") ?? params.get("account") ?? "";
  const evmAddress = params.get("evmAddress") ?? params.get("evm_address") ?? params.get("recipient") ?? "";
  return { route, midenAccount, destination: route.mode === "receive" ? midenAccount : evmAddress };
}

const MidenWalletButton = dynamic(
  () =>
    process.env.NEXT_PUBLIC_E2E_TEST === "true"
      ? import("../../wallets/testing/E2EMidenWalletButton").then(
          (mod) => mod.E2EMidenWalletButton,
        )
      : import("../../wallets/miden/MidenWalletButton").then(
          (mod) => mod.MidenWalletButton,
        ),
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

// ssr:false keeps the Epoch SDK + eager miden-sdk WASM out of the server render.
const EpochQuotePreview = dynamic(
  () => import("./EpochQuotePreview").then((mod) => mod.EpochQuotePreview),
  {
    ssr: false,
    // Shown while the (WASM-heavy) quote chunk loads — mirror the component's own
    // loading state so it reads as "fetching a quote", not a cryptic "…".
    loading: () => (
      <span className="epoch-quote-loading">
        <RefreshCcw size={14} className="animate-spin" aria-hidden="true" />
        Fetching quote…
      </span>
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
  const { walletInfo } = useWalletInfo();
  const evmIcon = walletInfo?.icon;
  const [initialForm] = useState(() => initialBridgeForm(searchParams));
  const [route, setRoute] = useState<BridgeRoute>(initialForm.route);
  const { provider, mode } = route;
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState(initialForm.destination);
  const walletAccount = address ?? "";
  const walletConnected = isConnected && Boolean(address);
  const externalAsset = route.source.kind === "miden" ? route.destination : route.source;
  const evmNetwork = evmNetworks[externalAsset.network === "miden-testnet" ? "sepolia" : externalAsset.network];
  const cctpNetwork = provider === "xreserve" && isCctpNetwork(route.source.network) ? route.source.network : null;
  const [midenWallet, setMidenWallet] =
    useState<MidenWalletSnapshot>(emptyMidenWallet);
  const launchMidenAccount = initialForm.midenAccount;
  const [walletError, setWalletError] = useState("");
  const [bridgeError, setBridgeError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState("");
  // Preflight review gate: a valid transfer opens this confirmation surface
  // first; the wallet is invoked only from its "Confirm in wallet" action, never
  // straight off the primary CTA. Cancelling just closes it (form state is
  // untouched, so all entered data is preserved).
  const [showPreflight, setShowPreflight] = useState(false);
  const [reviewedCctpQuote, setReviewedCctpQuote] = useState<CctpQuote>();
  // Reveals the full destination value in the preflight (a long Miden id / 0x
  // address is shortened by default, with an affordance to inspect it in full).
  const [showFullDestination, setShowFullDestination] = useState(false);
  const [preflightDestinationCopied, setPreflightDestinationCopied] =
    useState(false);
  // Whether the live Epoch quote is currently recomputing — lifted from
  // EpochQuotePreview so the CTA can show "Fetching quote…" instead of "Review".
  const [epochQuoteLoading, setEpochQuoteLoading] = useState(false);
  const destinationInputRef = useRef<HTMLInputElement>(null);
  const walletClusterRef = useRef<HTMLDivElement>(null);
  const preflightConfirmRef = useRef<HTMLButtonElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const preflightPreviousFocusRef = useRef<HTMLElement | null>(null);
  // Prefill the destination input with the connected wallet once per direction;
  // cleared in selectMode so switching modes re-prefills for the new side.
  const destinationPrefilledRef = useRef(false);
  // Live Epoch API quote amount, lifted from EpochQuotePreview so the
  // Min-received detail reflects the real quote (not a hardcoded estimate).
  const [epochQuoteAmount, setEpochQuoteAmount] = useState<string | undefined>(
    undefined,
  );
  const [activities, setActivities] = useState<Activity[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [evmMenuOpen, setEvmMenuOpen] = useState(false);
  const [evmCopied, setEvmCopied] = useState(false);
  const evmMenuRef = useRef<HTMLDivElement>(null);
  const [routeMenuOpen, setRouteMenuOpen] = useState(false);
  const routeMenuRef = useRef<HTMLDivElement>(null);
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

  const copy = {
    ...modes[mode],
    from: networkLabels[route.source.network],
    to: networkLabels[route.destination.network],
  };
  const providerCopy = providers[provider];
  const quote = useMemo(
    () => quoteFor(route, amount),
    [amount, route],
  );
  const destinationSymbol = quote.asset;
  const expectedReceivedAmount = quote.expectedReceived;
  // Min received: for Epoch use the live API quote; otherwise the route quote.
  const displayMinReceived =
    provider === "epoch" && epochQuoteAmount
      ? `${epochQuoteAmount} ${destinationSymbol}`
      : `${quote.minReceived} ${destinationSymbol}`;
  // Live Sepolia gas estimate for the network-fee line (real gasPrice * gas
  // limit) where the fee is Sepolia-side; falls back to the route label
  // (e.g. "Miden fee") when the leg's fee isn't on Sepolia.
  const sepoliaGas = useSepoliaGasEstimate(sepoliaGasUnitsFor(mode, provider));
  const networkFeeDisplay = sepoliaGas.fee
    ? sepoliaGas.fee
    : sepoliaGas.loading
      ? "Estimating…"
      : quote.networkFee;
  const isLiveAgglayerReceive = provider === "agglayer" && mode === "receive";

  // Warm the execute chunk (WASM-heavy) as soon as there's a valid amount, so
  // the click-to-wallet-prompt delay is minimal instead of "seeming stuck".
  useEffect(() => {
    if (!(Number(amount) > 0)) return;
    preloadBridgeSubmission(provider);
  }, [amount, provider]);
  const midenAddress = midenWallet.address || launchMidenAccount;
  // Map the form fields to the Epoch quote's directional roles:
  // - send (Miden→EVM): Miden wallet is the sender; the EVM recipient is the
  //   destination field (a 0x address) or the connected Sepolia wallet.
  // - receive (EVM→Miden): the connected Sepolia wallet is the source; the Miden
  //   recipient is the destination field or the connected Miden wallet.
  const epochEvmAddress =
    mode === "send"
      ? /^0x[0-9a-fA-F]{40}$/.test(destination.trim())
        ? destination.trim()
        : walletAccount
      : walletAccount;
  const epochMidenAccount =
    mode === "send" ? midenAddress : destination.trim() || midenAddress;
  const cctpQuery = useCctpQuote(cctpNetwork ? { network: cctpNetwork, amount, sender: walletAccount as `0x${string}`, recipient: epochMidenAccount } : null, showPreflight || isSubmitting);
  const cctpQuote = showPreflight ? reviewedCctpQuote : cctpQuery.data;
  const circleFeeDisplay = cctpQuote ? `${formatUnits(BigInt(cctpQuote.fee), 6)} USDC` : cctpQuery.isFetching ? "Fetching quote…" : "—";
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
  const agglayerEth = provider === "agglayer" && midenTokenBalance && midenTokenBalance.amountRaw > 0n
    ? midenTokenBalance
    : null;
  const midenBalanceText = midenWallet.connected
    ? midenTokenBalance && midenRouteToken
      ? `${compactTokenAmount(midenTokenBalance.balance)} ${midenRouteToken.symbol}`
      : "Syncing…"
    : launchMidenAccount
      ? "Launch account"
      : "Not connected";
  // Chain-specific wallet identity for the header pill + the From/To panels, so
  // each side explicitly names its wallet and shows its connection state.
  const evmIdentity = evmWalletIdentity({
    connected: walletConnected,
    networkLabel: evmNetwork.name,
    address: walletAccount,
  });
  const midenIdentity = midenWalletIdentity({
    connecting: midenWallet.connecting,
    connected: midenWallet.connected,
    ready: midenWallet.ready,
    address: midenAddress,
  });
  // Receive: Sepolia is the source, Miden the destination. Send flips it.
  const sourceIdentity = mode === "receive" ? evmIdentity : midenIdentity;
  const destinationIdentity =
    mode === "receive" ? midenIdentity : evmIdentity;
  const hasDestination = Boolean(
    destination.trim() || (mode === "receive" ? midenAddress : walletAccount),
  );
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
    Number(amount) + (cctpQuote && cctpNetwork ? Number(formatUnits(BigInt(cctpQuote.fee), 6)) : 0) > evmBalanceValue;
  const routeTone = providers[provider].disabled
    ? "disabled"
    : provider === "near-intents"
      ? "mock"
      : "testnet";
  const routeNote =
    provider === "near-intents"
      ? "NEAR Intents is paused in this build while Agglayer and Epoch are the active testnet routes."
      : provider === "xreserve"
        ? providers.xreserve.disclosure
      : provider === "agglayer"
        ? mode === "receive"
          ? "Your Sepolia wallet sends to Miden through Agglayer with no provider bridge fee (~10-20 min)."
          : "Bridge out from Miden through Agglayer. The Sepolia claim is auto-submitted by Gateway once the exit settles (~10-20 min) — nothing to claim manually."
        : "Testnet route. Epoch integration status is tracked from activity details.";
  // The connected wallet on the direction's source side — the guard for whether
  // the CTA should prompt a connection (receive sources from Sepolia, send from
  // the Miden wallet).
  const sourceConnected = mode === "receive" ? walletConnected : midenWallet.connected;
  // The resolved destination shown in the preflight: the typed value, else the
  // connected wallet on the receiving side (Miden for receive, Sepolia for send).
  const previewDestination =
    mode === "receive"
      ? destination.trim() || midenAddress
      : destination.trim() || walletAccount;
  // Deterministic CTA: incomplete form → connect → destination → review. Only a
  // "review" action reaches the preflight (and, from there, the wallet). Epoch's
  // live quote loading is a source-side concern, so it only gates once the
  // route is Epoch and everything else is ready.
  const cta = deriveCtaState({
    mode,
    sourceConnected,
    hasDestination,
    amount,
    sourceTokenSymbol,
    insufficientBalance,
    quoteLoading: (provider === "epoch" && epochQuoteLoading) || (Boolean(cctpNetwork) && cctpQuery.isFetching && !cctpQuote),
    isSubmitting,
    submitPhase,
    evmNetworkLabel: evmNetwork.name,
  });
  // Destination help is route-agnostic: it depends only on direction (receive =
  // Miden account, send = Sepolia address) and shows consistently on every route.
  const destinationHelp =
    mode === "receive"
      ? midenWallet.connected
        ? `Defaults to your connected Bread wallet ${shortAddress(midenAddress)}. Paste a different Miden account (mtst1…/30-hex) to override.`
        : launchMidenAccount
          ? `Preloaded from wallet launch: ${shortAddress(launchMidenAccount)}. Connect Bread before signing Miden-side actions.`
          : "Connect your Bread wallet, or paste a Miden account (mtst1…/30-hex)."
      : walletConnected
        ? `Defaults to your connected Sepolia wallet ${shortAddress(walletAccount)}. Paste a different 0x address to override.`
        : "Connect your Sepolia wallet, or paste a 0x destination address.";
  const showDestinationHelp = true;
  const destinationPlaceholder = isLiveAgglayerReceive
    ? "Miden account ID or address"
    : copy.destinationPlaceholder;
  const handleMidenWalletState = useCallback(
    (next: MidenWalletSnapshot) => setMidenWallet(next),
    [],
  );

  useEffect(() => {
    try {
      const stored = loadStoredActivities();
      queueMicrotask(() => setActivities(stored));
    } catch {
      queueMicrotask(() => setActivities([]));
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    saveStoredRoute(initialForm.route.provider, initialForm.route.id);
    saveStoredMode(initialForm.route.mode);
  }, [initialForm]);

  useEffect(() => {
    if (!hydrated) return;
    saveActivities(activities);
  }, [activities, hydrated]);

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

  useEffect(() => {
    if (!routeMenuOpen) return;

    function closeMenu(event: MouseEvent | PointerEvent) {
      if (!routeMenuRef.current?.contains(event.target as Node))
        closeRouteMenu(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeRouteMenu();
    }

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [routeMenuOpen]);

  // Mobile route and review surfaces freeze the page behind them. Preserve the
  // complete inline body state and scroll offset so closing (or unmounting)
  // returns the host page to exactly the state in which it was opened.
  useEffect(() => {
    if (!routeMenuOpen && !showPreflight) return;
    // The desktop route control remains an anchored popover, not an overlay.
    if (routeMenuOpen && !showPreflight && !mobileRouteSheet) return;
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
  }, [mobileRouteSheet, routeMenuOpen, showPreflight]);

  // Move focus onto the active option when the listbox opens so arrow-key
  // navigation and Enter/Space selection work without a mouse.
  useEffect(() => {
    if (!routeMenuOpen) return;
    const menu = routeMenuRef.current?.querySelector<HTMLElement>(
      ".route-options-menu",
    );
    const selectedOption = menu?.querySelector<HTMLElement>(
      '.route-option[aria-selected="true"]:not([disabled])',
    );
    const firstOption = menu?.querySelector<HTMLElement>(
      ".route-option:not([disabled])",
    );
    (selectedOption ?? firstOption)?.focus();
  }, [routeMenuOpen]);

  // Roving focus for the route listbox: Arrow keys move between enabled options,
  // Home/End jump to the ends. Enter/Space selection is native to the <button>
  // options; Escape closes via the document listener above.
  function handleRouteMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        ".route-option:not([disabled])",
      ),
    );
    if (options.length === 0) return;
    event.preventDefault();
    const currentIndex = options.indexOf(document.activeElement as HTMLElement);
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown")
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
    else if (event.key === "ArrowUp")
      nextIndex =
        currentIndex < 0
          ? options.length - 1
          : (currentIndex - 1 + options.length) % options.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    options[nextIndex]?.focus();
  }

  function handleRouteDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !mobileRouteSheet) return;
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

  // Default the destination input to the connected wallet on the relevant side
  // (Miden for receive, Sepolia for send). Runs once per direction; the user can
  // freely edit or clear it afterward.
  useEffect(() => {
    if (destinationPrefilledRef.current) return;
    const connected =
      mode === "receive"
        ? midenWallet.connected
          ? midenAddress
          : ""
        : walletConnected
          ? walletAccount
          : "";
    if (connected && !destination) {
      // Syncing the input to an external event (wallet connect), guarded to run
      // once per direction — not a render-derived cascade.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDestination(connected);
      destinationPrefilledRef.current = true;
    }
  }, [
    mode,
    midenWallet.connected,
    midenAddress,
    walletConnected,
    walletAccount,
    destination,
  ]);

  function selectMode(nextMode: FlowMode) {
    const nextRoute = nextMode === mode ? route : reverseBridgeRoute(route);
    if (!nextRoute) return;
    setRoute(nextRoute);
    // Remember the tab and route so a refresh keeps this direction.
    saveStoredMode(nextMode);
    saveStoredRoute(nextRoute.provider, nextRoute.id);
    setAmount("");
    setDestination("");
    destinationPrefilledRef.current = false;
    setBridgeError("");
  }

  // Connection status belongs in the panel; choosing an asset never requires
  // a wallet network change. Submission switches to the source chain if needed.
  function renderWalletChip(identity: WalletIdentity) {
    return (
      <span className={`wallet-chip ${identity.state}`}>
        <span className="wallet-chip-state">{identity.stateText}</span>
      </span>
    );
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

  // The Miden balance cell. Reactive + opt-in: it stays a "Show balance" button
  // (no popup) until the user asks, then shows the amount with a refresh control.
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
    if (midenBalance.loading) return <>Available Syncing…</>;
    return (
      <button
        type="button"
        className="balance-show"
        onClick={() => void midenBalance.show().catch(() => {})}
      >
        Show balance
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
      // Every live path records its activity only AFTER the tx is submitted (at
      // source_finality / message_observed), so a persisted signature-stage row
      // with no sourceTxHash is a stale leftover from a pre-refactor session,
      // not a resumable transfer.
      !(a.status === "signature" && !a.sourceTxHash),
  );

  // Settled transfers (complete/failed), newest first — a persisted history that
  // survives refresh from localStorage so users keep a record of past bridging.
  // Capped so the list stays glanceable; the full set remains in storage.
  const pastActivities = activities
    .filter((a) => a.status === "complete" || a.status === "failed")
    .slice(0, 12);

  function selectRoute(nextRoute: BridgeRoute) {
    if (nextRoute.id === route.id) return;
    if (routeSwitchChangesAsset(route, nextRoute)) {
      setAmount("");
      setEpochQuoteAmount(undefined);
    }
    setRoute(nextRoute);
    saveStoredRoute(nextRoute.provider, nextRoute.id);
    setBridgeError("");
    // Destination is route-agnostic: the connected Miden wallet address (bech32)
    // prefills for both routes and the Agglayer submit normalizes it to hex — so
    // Agglayer behaves exactly like Epoch (no special clearing here).
  }

  function selectRouteOption(nextRoute: BridgeRoute) {
    selectRoute(nextRoute);
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

  // Bring the header Miden wallet button into view and focus it — the send
  // source wallet connects from there (its own menu), so "Connect Miden wallet"
  // points the user at the right control rather than prompting from the CTA.
  function focusMidenWalletButton() {
    const pills =
      walletClusterRef.current?.querySelectorAll<HTMLButtonElement>(
        ".wallet-pill",
      );
    const midenPill = pills?.[pills.length - 1];
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    midenPill?.scrollIntoView({
      block: "center",
      behavior: reducedMotion ? "auto" : "smooth",
    });
    midenPill?.focus();
  }

  // The CTA never submits directly: it either advances the form (connect the
  // source wallet, focus the destination) or opens the preflight review. Only
  // the review's confirm action reaches submitTransfer.
  function handlePrimaryAction() {
    switch (cta.action) {
      case "connect-source":
        if (mode === "receive") void openWalletModal();
        else focusMidenWalletButton();
        return;
      case "add-destination":
        destinationInputRef.current?.focus();
        destinationInputRef.current?.scrollIntoView({ block: "center" });
        return;
      case "review":
        setBridgeError("");
        if (provider === "xreserve") {
          try { parseArcAmount(amount); }
          catch (error) { setBridgeError(errorMessage(error)); return; }
        }
        if (cctpNetwork) {
          if (!cctpQuery.data || cctpQuery.data.expiresAt <= Date.now()) {
            setBridgeError(cctpQuery.error?.message ?? "Refresh the Circle fee before reviewing.");
            void cctpQuery.refetch();
            return;
          }
          setReviewedCctpQuote(cctpQuery.data);
        }
        setShowFullDestination(false);
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
        cctpQuote: cctpNetwork ? reviewedCctpQuote : undefined,
        amount,
        destination,
        activities,
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
        agglayerEth,
        epochEvmAddress,
        epochMidenAccount,
      },
      {
        openEvmWallet: open,
        onError: setBridgeError,
        onSubmittingChange: setIsSubmitting,
        onPhaseChange: setSubmitPhase,
        onActivitiesChange: setActivities,
        navigate: (path) => router.push(path),
      },
    );
  }

  return (
    <main className="app-shell">
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
            <FaucetMenu />
            <ThemeToggle />
          </div>
          <div
            className="wallet-cluster"
            aria-label="Connected wallets"
            ref={walletClusterRef}
          >
          <div className="wallet-menu-root" ref={evmMenuRef}>
            <button
              className={`wallet-button wallet-pill ${walletConnected ? "connected" : ""}`}
              type="button"
              onClick={handleEvmWalletClick}
              aria-expanded={walletConnected ? evmMenuOpen : undefined}
              aria-haspopup={walletConnected ? "menu" : undefined}
              aria-label={evmIdentity.actionLabel}
            >
              <span
                className="wallet-avatar"
                style={
                  walletConnected
                    ? { background: walletGradient(walletAccount) }
                    : undefined
                }
              >
                <span className="wallet-avatar-badge">
                  <WalletBrandIcon
                    src={walletConnected ? evmIcon : undefined}
                    size={11}
                  />
                </span>
              </span>
              <span className="wallet-pill-label">{evmIdentity.pillLabel}</span>
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
                    <Wallet size={16} aria-hidden="true" />
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

            <MidenWalletButton onStateChange={handleMidenWalletState} />
          </div>
        </div>
      </header>
      {midenWallet.error ? (
        <p className="form-error topbar-error">{midenWallet.error}</p>
      ) : null}

      <section className="swap-stage">
        <div className="swap-group">
        <section className="swap-card" data-provider={provider} aria-label="Miden bridge" ref={swapCardRef}>
          <div className="swap-card-top">
            <h1>Bridge</h1>
            <div
              className="route-menu-root"
              data-open={routeMenuOpen}
              ref={routeMenuRef}
            >
              <button
                className="route-trigger"
                type="button"
                ref={routeTriggerRef}
                aria-expanded={routeMenuOpen}
                aria-haspopup={mobileRouteSheet ? "dialog" : "listbox"}
                aria-controls="bridge-route-listbox"
                onClick={() => setRouteMenuOpen((open) => !open)}
              >
                <span>Route</span>
                <strong>{providerCopy.label}</strong>
                <ChevronDown size={15} aria-hidden="true" />
              </button>

              {routeMenuOpen ? (
                <>
                  <button
                    type="button"
                    className="route-sheet-backdrop"
                    aria-label="Close route menu"
                    onClick={() => closeRouteMenu()}
                  />
                  <div
                    className="route-options-layer"
                    role={mobileRouteSheet ? "dialog" : undefined}
                    aria-modal={mobileRouteSheet ? "true" : undefined}
                    aria-label={mobileRouteSheet ? "Choose bridge route" : undefined}
                    onKeyDown={handleRouteDialogKeyDown}
                  >
                    <div
                      id="bridge-route-listbox"
                      className="route-options-menu route-options-list open"
                      role="listbox"
                      aria-label="Bridge route"
                      onKeyDown={handleRouteMenuKeyDown}
                    >
                  {(Object.keys(providers) as BridgeProvider[]).flatMap((key) => {
                    const routes = bridgeRoutes.filter((option) => option.provider === key && option.mode === mode);
                    const preferred = routes.find((option) => option.id === route.id) ?? routes.find((option) => option.source.network === route.source.network) ?? routes[0];
                    return [preferred].map((optionRoute) => {
                      const option = providers[key];
                      const c = option.comparison;
                      const selected = optionRoute?.id === route.id;
                      const disabled = !optionRoute;
                      return (
                        <button
                          className={`route-option ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}`}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          aria-disabled={disabled}
                          disabled={disabled}
                          key={optionRoute?.id ?? key}
                          onClick={() => optionRoute && selectRouteOption(optionRoute)}
                        >
                          <span className="route-option-head">
                            <strong>{option.label}</strong>
                            <small className="route-tag testnet">
                              {option.badge}
                            </small>
                            {selected ? (
                              <Check
                                className="route-check"
                                size={15}
                                aria-hidden="true"
                              />
                            ) : null}
                          </span>
                          <span className="route-option-sub">
                            {disabled ? c.unavailableReason ?? "Unavailable in this direction" : `${optionRoute?.source.symbol ?? "—"} · ${networkLabels[optionRoute!.source.network]}${key === "xreserve" ? "" : ` · ${c.eta}`}`}
                          </span>
                        </button>
                      );
                    });
                    })}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          {/* Keep the active route legible without reopening the menu: provider
              is on the trigger; asset + ETA + persistent Testnet status here. */}
          <div className="route-status-line" aria-label="Selected route summary">
            <span className={`route-pill ${routeTone}`}>
              {providerCopy.badge}
            </span>
            {provider !== "xreserve" ? <span className="route-pill">{quote.eta}</span> : null}
            {provider !== "xreserve" ? <InfoTip label={routeNote} /> : null}
          </div>

          {walletError ? (
            <p className="form-error compact">{walletError}</p>
          ) : null}

          <div
            className="mode-switch"
            role="group"
            aria-label="Cross-chain direction"
            data-active={mode}
          >
            {(Object.keys(modes) as FlowMode[]).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={item === mode}
                disabled={item !== mode && !reverseBridgeRoute(route)}
                title={item !== mode && !reverseBridgeRoute(route) ? "USDCx withdrawals are not available yet" : undefined}
                onClick={() => selectMode(item)}
              >
                {modes[item].label}
              </button>
            ))}
          </div>

          <div className="swap-box">
            <div className="swap-box-head">
              <span>From</span>
              <ChainSelect route={route} side="source" onSelectRoute={selectRoute} />
              {/* The Miden account is already in the field below, and a connected
                  Sepolia address is already in the header — so a chip here only
                  earns its space for an unconnected state (connect or
                  connecting). Once connected, the balance row is
                  all that's needed. */}
              {sourceIdentity === evmIdentity &&
              sourceIdentity.state !== "connected"
                ? renderWalletChip(sourceIdentity)
                : null}
            </div>
            <label className="swap-box-amount">
              <input
                aria-label="Amount"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <div className="swap-box-foot">
              {(() => {
                const line =
                  mode === "send" ? renderMidenBalance() : renderEvmBalance();
                return line ? (
                  <small className="balance-line">{line}</small>
                ) : null;
              })()}
            </div>
            <div className="swap-box-token">
              <TokenSelect
                route={route}
                side="source"
                onSelectRoute={selectRoute}
              />
            </div>
          </div>

          <div className="swap-divider" aria-hidden="true">
            <ArrowDown size={18} />
          </div>

          <div className="swap-box">
            <div className="swap-box-head">
              <span>To</span>
              <ChainSelect route={route} side="destination" onSelectRoute={selectRoute} />
              {destinationIdentity === evmIdentity &&
              destinationIdentity.state !== "connected"
                ? renderWalletChip(destinationIdentity)
                : null}
            </div>
            <label className="readonly-amount swap-box-amount">
              <strong>
                {provider === "epoch" ? (
                  <EpochQuotePreview
                    route={route}
                    amount={amount}
                    midenAccount={epochMidenAccount}
                    evmAddress={epochEvmAddress}
                    fallback={expectedReceivedAmount}
                    hideSymbol
                    onAmount={setEpochQuoteAmount}
                    onLoading={setEpochQuoteLoading}
                  />
                ) : (
                  expectedReceivedAmount
                )}
              </strong>
            </label>
            <div className="swap-box-foot">
              {(() => {
                const line =
                  mode === "receive" ? renderMidenBalance() : renderEvmBalance();
                return line ? (
                  <small className="balance-line">{line}</small>
                ) : null;
              })()}
            </div>
            <div className="swap-box-token">
              <TokenSelect
                route={route}
                side="destination"
                onSelectRoute={selectRoute}
              />
            </div>
          </div>

          <label className="destination-input">
            <span>{copy.destinationLabel}</span>
            <input
              ref={destinationInputRef}
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder={destinationPlaceholder}
              aria-label={copy.destinationLabel}
            />
            {showDestinationHelp ? <small>{destinationHelp}</small> : null}
          </label>
          {bridgeError ? <p className="form-error">{bridgeError}</p> : cctpNetwork && cctpQuery.error ? <p className="form-error">{cctpQuery.error.message}</p> : null}

          <div className="quote-summary" aria-label="Route quote">
            {cctpNetwork ? <div><span>Circle fee</span><strong>{circleFeeDisplay}</strong></div> : null}
            {provider !== "xreserve" ? <div>
              <span>ETA</span>
              <strong>{quote.eta}</strong>
            </div> : null}
            <div>
              <span>Min received</span>
              <strong>{displayMinReceived}</strong>
            </div>
            <div>
              <span>Network fee</span>
              <strong>{networkFeeDisplay}</strong>
            </div>
          </div>

          <div className="primary-action-dock">
            <button
              className="primary-button"
              type="button"
              ref={primaryActionRef}
              onClick={handlePrimaryAction}
              disabled={cta.disabled}
            >
              {cta.label}
              {isSubmitting ? (
                <RefreshCcw
                  size={18}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <ArrowRight size={18} aria-hidden="true" />
              )}
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
                    <ShieldCheck size={16} aria-hidden="true" />
                    Review {mode === "receive" ? "receive" : "send"}
                  </span>
                  <button
                    type="button"
                    className="preflight-close"
                    onClick={cancelPreflight}
                    aria-label="Cancel review"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>

                <div className="preflight-body">
                  <div className="preflight-route">
                    <strong>{copy.from}</strong>
                    <ArrowRight size={15} aria-hidden="true" />
                    <strong>{copy.to}</strong>
                    <span className="preflight-testnet">Testnet</span>
                  </div>

                  <dl className="preflight-rows">
                  <div>
                    <dt>You send</dt>
                    <dd>
                      {amount} {sourceAssetLabel(route.source)}
                    </dd>
                  </div>
                  <div>
                    <dt>Expected received</dt>
                    <dd>
                      {expectedReceivedAmount} {destinationSymbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Minimum received</dt>
                    <dd>{displayMinReceived}</dd>
                  </div>
                  <div>
                    <dt>Destination</dt>
                    <dd className="preflight-destination">
                      <span
                        id="preflight-destination-value"
                        className={showFullDestination ? "full" : undefined}
                        title={previewDestination}
                        aria-label={`Destination: ${previewDestination}`}
                      >
                        {showFullDestination
                          ? previewDestination
                          : shortAddress(previewDestination)}
                      </span>
                      {previewDestination.length > 16 ? (
                        <button
                          type="button"
                          className="preflight-inspect"
                          aria-controls="preflight-destination-value"
                          aria-expanded={showFullDestination}
                          aria-label={`${
                            showFullDestination ? "Hide" : "Show full"
                          } destination`}
                          onClick={() =>
                            setShowFullDestination((shown) => !shown)
                          }
                        >
                          {showFullDestination ? "Hide" : "Show full"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="preflight-inspect"
                        aria-label="Copy destination"
                        onClick={copyPreflightDestination}
                      >
                        {preflightDestinationCopied ? (
                          <Check size={14} aria-hidden="true" />
                        ) : (
                          <Copy size={14} aria-hidden="true" />
                        )}
                        {preflightDestinationCopied ? "Copied" : "Copy"}
                      </button>
                    </dd>
                  </div>
                  <div>
                    <dt>Route</dt>
                    <dd>{providerCopy.label}</dd>
                  </div>
                  {provider !== "xreserve" ? <div>
                    <dt>ETA</dt>
                    <dd>{quote.eta}</dd>
                  </div> : null}
                  <div>
                    <dt>Network fee</dt>
                    <dd>{networkFeeDisplay}</dd>
                  </div>
                  <div>
                    <dt>{cctpNetwork ? "Circle fee" : "Provider fee"}</dt>
                    <dd>{cctpNetwork ? circleFeeDisplay : quote.bridgeFee}</dd>
                  </div>
                  {cctpNetwork && cctpQuote ? <div><dt>Total USDC</dt><dd>{formatUnits(parseArcAmount(amount) + BigInt(cctpQuote.fee), 6)} USDC</dd></div> : null}
                  </dl>

                  <p className="preflight-note">{routeNote}</p>
                </div>

                <div className="preflight-actions">
                  <button
                    type="button"
                    className="secondary-button preflight-cancel"
                    onClick={cancelPreflight}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-button preflight-confirm"
                    ref={preflightConfirmRef}
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

        {(inFlightActivities.length > 0 || pastActivities.length > 0) && (
          <div className="activity-region">
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
                      href={`/activity/${activity.id}`}
                      key={activity.id}
                    >
                      <span
                        className={`status-dot ${statusTone(activity.status)}`}
                      />
                      <span className="activity-copy">
                        <strong>{activity.summary}</strong>
                        <small>
                          {providers[activity.provider].label} -{" "}
                          {statusLabel(activity.status)}
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
        )}
        </div>
      </section>
    </main>
  );
}
