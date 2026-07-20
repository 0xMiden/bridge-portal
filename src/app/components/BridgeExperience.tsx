"use client";

import {
  AlertTriangle,
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
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatEther, parseUnits } from "viem";
import {
  AGGLAYER_BALI,
  buildSepoliaDepositTransaction,
  normalizeMidenAccountHex,
} from "../lib/agglayer";
import {
  type BridgeProvider,
  type FlowMode,
  type Activity,
  type WalletIdentity,
  SEPOLIA_CHAIN_ID,
  evmWalletIdentity,
  midenWalletIdentity,
  createActivity,
  deriveCtaState,
  loadStoredActivities,
  loadStoredMode,
  loadStoredRoute,
  modes,
  patchStoredActivity,
  providers,
  quoteFor,
  routeSwitchChangesAsset,
  saveActivities,
  saveStoredMode,
  saveStoredRoute,
  shortAddress,
  statusLabel,
  statusTone,
  walletGradient,
} from "../lib/bridge-state";
import { sepoliaGasUnitsFor, useSepoliaGasEstimate } from "../lib/sepolia-gas";
import { RelativeTime } from "./RelativeTime";
import { TokenSelect } from "./TokenSelect";
import type {
  MidenRouteBalances,
  ResolvedEthAsset,
} from "../lib/agglayer-eth-faucet";
import {
  useAppKit,
  useAppKitAccount,
  useAppKitNetwork,
  useAppKitProvider,
  useDisconnect,
  useWalletInfo,
} from "@reown/appkit/react";
import { type EvmProvider, ensureSepolia } from "../lib/evm-wallet";
// Type-only import — erased at build, so the eager-WASM adapter never reaches SSR.
import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";

// Sepolia USDC for the Epoch route (Epoch's SIO route is USDC<->USDC). This test
// token reports 18 decimals (not the usual 6). Mint it on the Epoch dashboard.
const EPOCH_SEPOLIA_USDC = {
  address: "0x2BB4FfD7E2c6D432b697554Efd77fA13bdbefd69",
  decimals: 18,
} as const;

// The Miden-side token each route moves, for the destination balance readout.
const MIDEN_ROUTE_TOKEN: Partial<
  Record<BridgeProvider, { faucetId: string; decimals: number; symbol: string }>
> = {
  epoch: { faucetId: "0xfc90f0f4da30e51168453b60eafed7", decimals: 6, symbol: "USDC" },
  agglayer: { faucetId: "0x387149ae66116cf114eebd60bb7381", decimals: 8, symbol: "ETH" },
};

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
  requestAssets?: MidenFiWalletContextState["requestAssets"];
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
  if (value === "near-intents" || value === "agglayer" || value === "epoch")
    return value;
  return null;
}

function modeFromIntent(value: string | null): FlowMode | null {
  if (value === "receive" || value === "deposit") return "receive";
  if (value === "send" || value === "withdraw") return "send";
  return null;
}

const MidenWalletButton = dynamic(
  () =>
    process.env.NEXT_PUBLIC_E2E_TEST === "true"
      ? import("./E2EMidenWalletButton").then((mod) => mod.E2EMidenWalletButton)
      : import("./MidenWalletButton").then((mod) => mod.MidenWalletButton),
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

// A wallet rejection is a normal user action, not a failure — detect it so the
// UI can show a short, friendly line instead of a raw multi-line SDK/viem dump.
function isUserRejection(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 4001
  ) {
    return true;
  }
  const message = (
    error instanceof Error ? error.message : String(error ?? "")
  ).toLowerCase();
  return (
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("denied transaction") ||
    message.includes("rejected the request") ||
    message.includes("action_rejected")
  );
}

function errorMessage(error: unknown) {
  if (isUserRejection(error)) return "You cancelled the request in your wallet.";
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error)
    return String(error.message);
  return "Something went wrong. Try again.";
}

// Human labels for the Epoch SDK's execution phases, so the button reflects
// real progress (approve/deposit/batch) instead of a frozen "Waiting".
const EPOCH_PHASE_LABEL: Record<string, string> = {
  starting: "Preparing your Epoch deposit…",
  "switching-chain": "Switch to Sepolia in your wallet…",
  "preparing-transaction": "Preparing your Epoch deposit…",
  "waiting-for-transaction": "Confirming your deposit on Sepolia…",
  batching: "Approve &amp; deposit in your wallet…",
  sending: "Confirm the deposit in your wallet…",
  // After the deposit is broadcast, solveIntent keeps running while Epoch's
  // solver delivers on Miden — no further phases fire, so this label persists
  // and must explain the wait rather than read as a generic "submitting".
  sent: "Deposit sent — Epoch is delivering to Miden (1–3 min)…",
};

// A full Sepolia (66-char) tx hash — used to gate the early jump to the detail
// page on a real deposit tx rather than an abbreviated/absent value.
function isSepoliaTxHash(value: string | undefined): value is string {
  return !!value && /^0x[0-9a-fA-F]{64}$/.test(value);
}

// Derive the 0x-prefixed Miden account id for a receive so the activity can link
// to the Midenscan account page. Epoch receives carry no AggLayer bridge
// destination, so the recipient account is the only handle we can persist.
function midenAccountLink(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return `0x${normalizeMidenAccountHex(value)}`;
  } catch {
    return undefined;
  }
}

// Warm the heavy client-only execute chunks (each eager-loads WASM) ahead of the
// click so the wallet prompt appears promptly instead of after a long load.
let epochExecutePreload: Promise<unknown> | null = null;
function preloadEpochExecute() {
  epochExecutePreload ??= import("../lib/epoch/epoch-execute");
}
let agglayerExecutePreload: Promise<unknown> | null = null;
function preloadAgglayerExecute() {
  agglayerExecutePreload ??= import("../lib/agglayer-execute");
}

function compactTokenAmount(value: string) {
  // A nonzero amount below the 4-dp display precision shouldn't read as "0".
  const num = Number(value);
  if (num > 0 && num < 0.0001) return "<0.0001";
  const [whole, fraction = ""] = value.split(".");
  const compactFraction = fraction.slice(0, 4).replace(/0+$/, "");
  return compactFraction ? `${whole}.${compactFraction}` : whole;
}

export function BridgeExperience() {
  const router = useRouter();
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { chainId } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider<EvmProvider>("eip155");
  const { disconnect } = useDisconnect();
  const { walletInfo } = useWalletInfo();
  const evmIcon = walletInfo?.icon;
  const [provider, setProvider] = useState<BridgeProvider>("epoch");
  const [mode, setMode] = useState<FlowMode>("receive");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const walletAccount = address ?? "";
  const walletConnected = isConnected && Boolean(address);
  // Connected but the wallet is pointed at a chain other than Sepolia — surfaced
  // inline (pill + panel) with a switch action. Unknown chainId isn't "wrong".
  const wrongNetwork =
    walletConnected &&
    chainId != null &&
    Number(chainId) !== SEPOLIA_CHAIN_ID;
  const [evmBalance, setEvmBalance] = useState("");
  // Numeric Sepolia balance of the route's source token, for the
  // insufficient-balance guard (null = unknown / not yet loaded).
  const [evmBalanceValue, setEvmBalanceValue] = useState<number | null>(null);
  const [midenWallet, setMidenWallet] =
    useState<MidenWalletSnapshot>(emptyMidenWallet);
  const [launchMidenAccount, setLaunchMidenAccount] = useState("");
  const [walletError, setWalletError] = useState("");
  const [bridgeError, setBridgeError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState("");
  // Preflight review gate: a valid transfer opens this confirmation surface
  // first; the wallet is invoked only from its "Confirm in wallet" action, never
  // straight off the primary CTA. Cancelling just closes it (form state is
  // untouched, so all entered data is preserved).
  const [showPreflight, setShowPreflight] = useState(false);
  // Reveals the full destination value in the preflight (a long Miden id / 0x
  // address is shortened by default, with an affordance to inspect it in full).
  const [showFullDestination, setShowFullDestination] = useState(false);
  // Whether the live Epoch quote is currently recomputing — lifted from
  // EpochQuotePreview so the CTA can show "Fetching quote…" instead of "Review".
  const [epochQuoteLoading, setEpochQuoteLoading] = useState(false);
  const destinationInputRef = useRef<HTMLInputElement>(null);
  const walletClusterRef = useRef<HTMLDivElement>(null);
  const preflightConfirmRef = useRef<HTMLButtonElement>(null);
  // Prefill the destination input with the connected wallet once per direction;
  // cleared in selectMode so switching modes re-prefills for the new side.
  const destinationPrefilledRef = useRef(false);
  // Miden per-token balances (private → fetched via a one-time requestAssets
  // popup on connect). Keyed by provider. In-flight ref dedups the popup across
  // StrictMode's double-mount so it only ever asks once.
  const [midenBalances, setMidenBalances] = useState<Record<
    string,
    string
  > | null>(null);
  // The Agglayer wrapped-ETH the wallet actually holds, resolved at runtime (its
  // faucet id is minted fresh on every Gateway redeploy, so it can't be
  // hardcoded). Drives the Agglayer balance now; the send will reuse its faucet.
  const [agglayerEth, setAgglayerEth] = useState<ResolvedEthAsset | null>(null);
  const [midenBalanceFetchedFor, setMidenBalanceFetchedFor] = useState("");
  // Reading the (private) Miden balance opens a MidenFi confirmation popup, so we
  // never do it automatically. The fetch runs only for the account the user has
  // explicitly asked to see — via "Show balance" or the refresh button — which
  // is recorded here. Cleared on disconnect / account change so a new account
  // shows the button again rather than popping unprompted.
  const [balanceRequestedFor, setBalanceRequestedFor] = useState("");
  // Live Epoch API quote amount, lifted from EpochQuotePreview so the
  // Min-received detail reflects the real quote (not a hardcoded estimate).
  const [epochQuoteAmount, setEpochQuoteAmount] = useState<string | undefined>(
    undefined,
  );
  const midenBalanceInflightRef = useRef<Promise<MidenRouteBalances> | null>(
    null,
  );
  const [activities, setActivities] = useState<Activity[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [evmMenuOpen, setEvmMenuOpen] = useState(false);
  const [evmCopied, setEvmCopied] = useState(false);
  const evmMenuRef = useRef<HTMLDivElement>(null);
  const [routeMenuOpen, setRouteMenuOpen] = useState(false);
  const routeMenuRef = useRef<HTMLDivElement>(null);

  const copy = modes[mode];
  const providerCopy = providers[provider];
  const quote = useMemo(
    () => quoteFor(mode, provider, amount),
    [amount, mode, provider],
  );
  // The received-token unit for the "To" box pill: Epoch bridges USDC, Agglayer ETH.
  const destinationSymbol =
    provider === "epoch" ? "USDC" : copy.assetOut.replace("Miden ", "");
  // Amount without the trailing symbol (the pill renders the symbol separately).
  const expectedReceivedAmount = quote.expectedReceived.replace(
    /\s*[A-Za-z]+$/,
    "",
  );
  // Min received: for Epoch use the live API quote; otherwise the route quote.
  const displayMinReceived =
    provider === "epoch" && epochQuoteAmount
      ? `${epochQuoteAmount} USDC`
      : quote.minReceived;
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
    if (provider === "epoch") preloadEpochExecute();
    else if (provider === "agglayer") preloadAgglayerExecute();
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
  const evmWalletLabel = walletInfo?.name ?? "Sepolia";
  const evmBalanceText = walletConnected
    ? evmBalance || "Balance unavailable"
    : "Not connected";
  const midenRouteToken = MIDEN_ROUTE_TOKEN[provider];
  const midenBalanceText = midenWallet.connected
    ? midenBalances && midenRouteToken
      ? `${compactTokenAmount(midenBalances[provider] ?? "0")} ${midenRouteToken.symbol}`
      : "Syncing…"
    : launchMidenAccount
      ? "Launch account"
      : "Not connected";
  // Chain-specific wallet identity for the header pill + the From/To panels, so
  // each side explicitly names its wallet and shows its connection state.
  const evmIdentity = evmWalletIdentity({
    connected: walletConnected,
    wrongNetwork,
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
  const sourceTokenSymbol = provider === "epoch" ? "USDC" : "ETH";
  const insufficientBalance =
    mode === "receive" &&
    walletConnected &&
    evmBalanceValue != null &&
    Number(amount) > 0 &&
    Number(amount) > evmBalanceValue;
  const routeTone = providers[provider].disabled
    ? "disabled"
    : provider === "near-intents"
      ? "mock"
      : "testnet";
  const routeNote =
    provider === "near-intents"
      ? "NEAR Intents is paused in this build while Agglayer and Epoch are the active testnet routes."
      : provider === "agglayer"
        ? mode === "receive"
          ? "Your Sepolia wallet sends to Miden through Agglayer with no provider bridge fee (~10-20 min)."
          : "Bridge out from Miden through Agglayer. The Sepolia claim is auto-submitted by the gateway once the exit settles (~10-20 min) — nothing to claim manually."
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
    quoteLoading: provider === "epoch" && epochQuoteLoading,
    isSubmitting,
    submitPhase,
  });
  // Destination help is route-agnostic: it depends only on direction (receive =
  // Miden account, send = Sepolia address) and shows consistently on every route.
  const destinationHelp =
    mode === "receive"
      ? midenWallet.connected
        ? `Defaults to your connected Miden wallet ${shortAddress(midenAddress)}. Paste a different Miden account (mcst1…/30-hex) to override.`
        : launchMidenAccount
          ? `Preloaded from wallet launch: ${shortAddress(launchMidenAccount)}. Connect MidenFi before signing Miden-side actions.`
          : "Connect your Miden wallet, or paste a Miden account (mcst1…/30-hex)."
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
    const params = new URLSearchParams(window.location.search);
    const nextMode = modeFromIntent(params.get("intent") ?? params.get("mode"));
    const nextProvider = providerFromParam(
      params.get("provider") ?? params.get("route"),
    );
    const nextMidenAccount =
      params.get("midenAccount") ??
      params.get("miden_account") ??
      params.get("account");
    const nextEvmAddress =
      params.get("evmAddress") ??
      params.get("evm_address") ??
      params.get("recipient");
    // No URL intent → fall back to the last tab the user was on (then Receive).
    const storedMode = nextMode ? null : loadStoredMode();
    const resolvedMode = nextMode ?? storedMode ?? "receive";

    queueMicrotask(() => {
      if (nextProvider && !providers[nextProvider].disabled) {
        // An explicit ?route= / ?provider= wins and becomes the new sticky choice.
        setProvider(nextProvider);
        saveStoredRoute(nextProvider);
      } else {
        // No URL override: return to the last route the user picked.
        const storedProvider = loadStoredRoute();
        if (storedProvider) setProvider(storedProvider);
      }
      if (nextMode) {
        // An explicit ?intent= / ?mode= wins and becomes the new sticky tab.
        setMode(nextMode);
        saveStoredMode(nextMode);
      } else if (storedMode) {
        setMode(storedMode);
      }

      if (nextMidenAccount) {
        setLaunchMidenAccount(nextMidenAccount);
        if (resolvedMode === "receive") {
          setDestination(nextMidenAccount);
        }
      }

      if (nextEvmAddress && resolvedMode === "send") {
        setDestination(nextEvmAddress);
      }
    });
  }, []);

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
        setRouteMenuOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setRouteMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [routeMenuOpen]);

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

  useEffect(() => {
    if (!walletAccount) return;

    let cancelled = false;
    // Show the balance of the token this route actually moves on Sepolia:
    // Epoch bridges USDC, Agglayer bridges native ETH.
    const isEpoch = provider === "epoch";
    const url = isEpoch
      ? `/api/sepolia/balance?address=${walletAccount}&token=${EPOCH_SEPOLIA_USDC.address}&decimals=${EPOCH_SEPOLIA_USDC.decimals}`
      : `/api/sepolia/balance?address=${walletAccount}`;
    fetch(url)
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("Unable to fetch balance")),
      )
      .then((payload: { balanceWei?: string; balance?: string }) => {
        if (cancelled) return;
        if (isEpoch) {
          setEvmBalance(`${compactTokenAmount(payload.balance ?? "0")} USDC`);
          setEvmBalanceValue(Number(payload.balance ?? "0"));
        } else {
          const eth = formatEther(BigInt(payload.balanceWei ?? "0"));
          setEvmBalance(`${compactTokenAmount(eth)} ETH`);
          setEvmBalanceValue(Number(eth));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvmBalance("");
          setEvmBalanceValue(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [walletAccount, provider]);

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

  // Load the Miden token balances once per connected account. requestAssets
  // opens a MidenFi permission popup (balances are private); the in-flight ref
  // collapses concurrent/StrictMode calls into a single popup.
  const requestMidenAssets = midenWallet.requestAssets;
  useEffect(() => {
    if (!midenWallet.connected) {
      midenBalanceInflightRef.current = null;
      // Reset only on actual disconnect — syncing to an external event.
      /* eslint-disable react-hooks/set-state-in-effect */
      setMidenBalances(null);
      setAgglayerEth(null);
      setMidenBalanceFetchedFor("");
      setBalanceRequestedFor("");
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    // Connected but the adapter's requestAssets/address hasn't settled yet — wait
    // rather than resetting (a transient undefined must not re-trigger the popup).
    if (!requestMidenAssets || !midenAddress) return;
    // Never fetch (and never open the popup) unless the user explicitly asked to
    // see this account's balance.
    if (balanceRequestedFor !== midenAddress) return;
    if (midenBalanceFetchedFor === midenAddress) return;

    let cancelled = false;
    const run =
      midenBalanceInflightRef.current ??
      (midenBalanceInflightRef.current = (async () => {
        const { fetchMidenRouteBalances } = await import(
          "../lib/agglayer-eth-faucet"
        );
        return fetchMidenRouteBalances(requestMidenAssets);
      })());

    run
      .then((result) => {
        if (cancelled) return;
        setMidenBalances({ epoch: result.epoch, agglayer: result.agglayer });
        setAgglayerEth(result.agglayerEth);
        setMidenBalanceFetchedFor(midenAddress);
      })
      .catch(() => {
        if (!cancelled) {
          setMidenBalances(null);
          setAgglayerEth(null);
        }
      })
      .finally(() => {
        if (midenBalanceInflightRef.current === run)
          midenBalanceInflightRef.current = null;
      });

    return () => {
      cancelled = true;
    };
  }, [
    midenWallet.connected,
    requestMidenAssets,
    midenAddress,
    midenBalanceFetchedFor,
    balanceRequestedFor,
  ]);

  function selectMode(nextMode: FlowMode) {
    setMode(nextMode);
    // Remember the tab so a refresh keeps this direction.
    saveStoredMode(nextMode);
    setAmount("");
    setDestination("");
    destinationPrefilledRef.current = false;
    setBridgeError("");
  }

  // First reveal: user opts in to the balance popup for the connected account.
  function showMidenBalance() {
    setBalanceRequestedFor(midenAddress);
  }

  // Re-sync the Miden balance (opens a fresh requestAssets popup by clearing the
  // fetched marker so the balance effect re-runs). Only ever called from the
  // refresh button — never automatically.
  function refreshMidenBalance() {
    midenBalanceInflightRef.current = null;
    setMidenBalanceFetchedFor("");
    setBalanceRequestedFor(midenAddress);
  }

  // The chain-specific wallet identity line for a From/To panel: names the
  // wallet and shows its live connection state (address / not connected /
  // connecting / wrong network / not installed). Connection itself stays with
  // the header pills + primary CTA; the panel only exposes state, plus an inline
  // switch when the connected Sepolia wallet is on the wrong network.
  function renderWalletChip(identity: WalletIdentity) {
    return (
      <span className={`wallet-chip ${identity.state}`}>
        <span className="wallet-chip-state">{identity.stateText}</span>
        {identity.state === "wrong-network" ? (
          <button
            type="button"
            className="wallet-chip-switch"
            onClick={switchToSepolia}
          >
            Switch to Sepolia
          </button>
        ) : null}
      </span>
    );
  }

  // The Sepolia balance line — shown only once the wallet is connected (the chip
  // above owns the disconnected/connecting/wrong-network states).
  function renderEvmBalance() {
    if (!walletConnected) return null;
    return <>Available {evmBalanceText}</>;
  }

  // The Miden balance cell. Reactive + opt-in: it stays a "Show balance" button
  // (no popup) until the user asks, then shows the amount with a refresh control.
  function renderMidenBalance() {
    // Connection state (not connected / connecting / launch-account) lives in the
    // wallet chip above; the balance line only appears once there's a balance.
    if (!midenWallet.connected) return null;
    if (midenBalances && midenRouteToken) {
      return (
        <>
          Available {midenBalanceText}
          <button
            type="button"
            className="balance-refresh"
            onClick={refreshMidenBalance}
            aria-label="Refresh Miden balance"
            title="Refresh Miden balance"
          >
            <RefreshCcw size={12} aria-hidden="true" />
          </button>
        </>
      );
    }
    if (balanceRequestedFor === midenAddress) return <>Available Syncing…</>;
    return (
      <button
        type="button"
        className="balance-show"
        onClick={showMidenBalance}
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

  function selectProvider(nextProvider: BridgeProvider) {
    if (providers[nextProvider].disabled) return;
    if (nextProvider === provider) return;
    // The routes move different assets (Epoch = USDC, Agglayer = ETH). When the
    // asset changes, an amount entered for the old route must not carry over as
    // the same number of a different token — clear it and drop any stale quote so
    // no previous-route quote or token label survives the transition. Same-asset
    // switches keep the amount.
    if (routeSwitchChangesAsset(provider, nextProvider)) {
      setAmount("");
      setEpochQuoteAmount(undefined);
    }
    setProvider(nextProvider);
    // Remember the choice so a refresh comes back to this route.
    saveStoredRoute(nextProvider);
    setBridgeError("");
    // Destination is route-agnostic: the connected Miden wallet address (bech32)
    // prefills for both routes and the Agglayer submit normalizes it to hex — so
    // Agglayer behaves exactly like Epoch (no special clearing here).
  }

  function selectRouteOption(nextProvider: BridgeProvider) {
    selectProvider(nextProvider);
    setRouteMenuOpen(false);
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
      setWalletError("Could not copy the Sepolia address from this browser.");
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
    setEvmBalance("");
  }

  async function switchToSepolia() {
    setWalletError("");
    try {
      if (!walletProvider) throw new Error("Connect your Sepolia wallet first.");
      await ensureSepolia(walletProvider);
    } catch (error) {
      setWalletError(errorMessage(error));
    }
  }

  async function switchSepoliaFromMenu() {
    setEvmMenuOpen(false);
    await switchToSepolia();
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
    midenPill?.scrollIntoView({ block: "center", behavior: "smooth" });
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
        setShowFullDestination(false);
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
  }

  function confirmPreflight() {
    setShowPreflight(false);
    void submitTransfer();
  }

  // While the preflight is open, focus its confirm action and let Escape cancel
  // it — keyboard parity with the rest of the flow.
  useEffect(() => {
    if (!showPreflight) return;
    preflightConfirmRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setShowPreflight(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [showPreflight]);

  async function submitTransfer() {
    setBridgeError("");
    setWalletError("");

    if (providers[provider].disabled) {
      setBridgeError("This route isn't available in this build.");
      return;
    }
    // Guard the deposit before opening the wallet: a request above the Sepolia
    // balance reverts on-chain (MetaMask "likely to fail").
    if (insufficientBalance) {
      setBridgeError(
        `Not enough ${sourceTokenSymbol} — this wallet holds ${evmBalance}. Lower the amount.`,
      );
      return;
    }
    // Every send signs on Miden (Epoch send + Agglayer bridge-out) — require the
    // MidenFi wallet up front so the CTA and error are clear (not a late throw).
    if (mode === "send" && !midenWallet.connected) {
      setBridgeError("Connect your MidenFi wallet to sign the send.");
      return;
    }

    if (provider === "agglayer" && mode === "send") {
      setIsSubmitting(true);
      const senderAddress = midenAddress;
      if (
        !midenWallet.connected ||
        !midenWallet.requestTransaction ||
        !midenWallet.waitForTransaction ||
        !senderAddress
      ) {
        setBridgeError(
          "Connect your MidenFi wallet before bridging out to Sepolia.",
        );
        setIsSubmitting(false);
        return;
      }
      const destinationAddress = destination.trim() || walletAccount;
      if (!/^0x[0-9a-fA-F]{40}$/.test(destinationAddress)) {
        setBridgeError(
          "Enter a valid Sepolia (0x…) destination, or connect your Sepolia wallet.",
        );
        setIsSubmitting(false);
        return;
      }
      // The wrapped-ETH faucet + its decimals are resolved from the wallet's
      // held asset (Show balance) — there's no hardcodeable id. Require it so we
      // burn the exact token the user holds, at its real precision.
      if (!agglayerEth) {
        setBridgeError(
          'Tap "Show balance" first so we can detect the Miden ETH you\'re sending.',
        );
        setIsSubmitting(false);
        return;
      }
      let unitsAmount: bigint;
      try {
        unitsAmount = parseUnits(amount, agglayerEth.decimals);
      } catch {
        setBridgeError("Enter a valid amount.");
        setIsSubmitting(false);
        return;
      }
      if (unitsAmount <= BigInt(0)) {
        setBridgeError("Enter an amount greater than zero.");
        setIsSubmitting(false);
        return;
      }

      setSubmitPhase("Preparing bridge note…");
      try {
        // Submit first — the wallet approval + note proving happen here. Only
        // once the send actually goes through do we record an activity row.
        // Dynamic import: agglayer-execute pulls the eager-WASM SDK + wallet
        // adapter, so it must load client-side at click time, never in SSR.
        const { runAgglayerSend } = await import("../lib/agglayer-execute");
        setSubmitPhase("Confirm in your wallet…");
        const { txHash } = await runAgglayerSend({
          amount: unitsAmount,
          faucetId: agglayerEth.faucetId,
          destinationAddress,
          senderAddress,
          requestTransaction: midenWallet.requestTransaction,
          waitForTransaction: midenWallet.waitForTransaction,
        });
        // Note submitted on Miden; Agglayer hasn't observed the exit yet.
        const activity = createActivity(mode, provider, amount, {
          status: "source_finality",
          eta: "10-20 min",
          destination: destinationAddress,
          // origin = Miden rollup 78, destination = Ethereum L1 (0)
          sourceNetworkId: AGGLAYER_BALI.destinationNetworkId,
          destinationNetworkId: AGGLAYER_BALI.sourceNetworkId,
          // The real on-chain Miden tx hash (not the wallet request UUID) — this
          // feeds the Midenscan /tx/ deep link on the send detail page.
          midenTxId: txHash,
        });
        const updated = [activity, ...activities];
        setActivities(updated);
        saveActivities(updated);
        router.push(`/activity/${activity.id}`);
      } catch (error) {
        setBridgeError(errorMessage(error));
      } finally {
        setIsSubmitting(false);
        setSubmitPhase("");
      }
      return;
    }

    if (isLiveAgglayerReceive) {
      setIsSubmitting(true);
      if (!walletConnected || !walletProvider || !walletAccount) {
        await open();
        setIsSubmitting(false);
        return;
      }
      const account = walletAccount;
      const destinationAccount = destination.trim() || midenAddress;
      if (!destinationAccount) {
        setBridgeError(
          "Connect Miden wallet or paste a Miden account ID before receiving.",
        );
        setIsSubmitting(false);
        return;
      }
      let transaction: ReturnType<typeof buildSepoliaDepositTransaction>;
      try {
        await ensureSepolia(walletProvider);
        transaction = buildSepoliaDepositTransaction({
          amountEth: amount,
          midenAccountId: normalizeMidenAccountHex(destinationAccount),
        });
      } catch (error) {
        setBridgeError(errorMessage(error));
        setIsSubmitting(false);
        return;
      }

      setSubmitPhase("Confirm in your wallet…");
      try {
        // Sign + submit the Sepolia deposit first (wallet approval here). Only
        // record the activity row once the deposit tx is actually broadcast.
        const txHash = await walletProvider.request<string>({
          method: "eth_sendTransaction",
          params: [
            {
              from: account,
              to: transaction.to,
              data: transaction.data,
              value: transaction.value,
              gas: transaction.gas,
            },
          ],
        });
        setSubmitPhase("Submitting…");
        const activity = createActivity(mode, provider, amount, {
          status: "source_finality",
          eta: "10-20 min",
          destination: destinationAccount,
          bridgeDestinationAddress: transaction.destinationAddress,
          midenAccountHex: midenAccountLink(destinationAccount),
          // midenTxId is left unset until the bridge creates the note on Miden;
          // the monitor fills it with the real claim_tx_hash (the destination
          // address is not a transaction and must not seed the Midenscan link).
          sourceNetworkId: AGGLAYER_BALI.sourceNetworkId,
          destinationNetworkId: AGGLAYER_BALI.destinationNetworkId,
          txHash: shortAddress(txHash),
          sourceTxHash: txHash,
        });
        const updated = [activity, ...activities];
        setActivities(updated);
        saveActivities(updated);
        router.push(`/activity/${activity.id}`);
      } catch (error) {
        setBridgeError(errorMessage(error));
      } finally {
        setIsSubmitting(false);
        setSubmitPhase("");
      }
      return;
    }

    if (provider === "epoch") {
      setIsSubmitting(true);
      // Receive (EVM→Miden) signs a Sepolia deposit, so it needs a connected
      // EVM wallet on Sepolia. Send (Miden→EVM) signs only on Miden.
      if (mode === "receive") {
        if (!walletConnected || !walletProvider || !walletAccount) {
          await open();
          setIsSubmitting(false);
          return;
        }
        try {
          await ensureSepolia(walletProvider);
        } catch (error) {
          setBridgeError(errorMessage(error));
          setIsSubmitting(false);
          return;
        }
      }

      const resolvedDestination =
        mode === "send" ? epochEvmAddress : epochMidenAccount;
      // Require a valid recipient before starting, so a missing destination
      // doesn't create a failed ("Needs recovery") activity.
      if (mode === "receive" && !resolvedDestination) {
        setBridgeError(
          "Connect your Miden wallet or paste a Miden account to receive into.",
        );
        setIsSubmitting(false);
        return;
      }
      if (
        mode === "send" &&
        !/^0x[0-9a-fA-F]{40}$/.test(resolvedDestination)
      ) {
        setBridgeError(
          "Enter a valid Sepolia (0x…) address, or connect your Sepolia wallet.",
        );
        setIsSubmitting(false);
        return;
      }
      setSubmitPhase(
        mode === "receive"
          ? "Preparing your Epoch deposit…"
          : "Preparing your Epoch send…",
      );
      // Open the transfer's detail page up front, then run the transfer. The
      // Epoch SDK doesn't reliably surface the deposit tx hash mid-flight for the
      // injected/live wallet path, so waiting on it left the button frozen at
      // "Preparing…" long after the Sepolia deposit had already confirmed.
      // Instead the row is created + navigated to immediately (a live,
      // monitorable page), patched as the transfer progresses and resolves, and
      // removed / marked failed if the wallet prompt is rejected.
      let activityId: string | null = null;
      try {
        // Dynamic import: epoch-execute pulls eager-WASM miden-sdk, so it must
        // load client-side at click time, never in the server render.
        const { runEpochTransfer } = await import("../lib/epoch/epoch-execute");

        const optimistic = createActivity(mode, "epoch", amount, {
          status: "source_finality",
          eta:
            mode === "receive"
              ? "Confirm the deposit in your wallet…"
              : "Confirm the send in your wallet…",
          destination: resolvedDestination,
          midenAccountHex:
            mode === "receive" ? midenAccountLink(resolvedDestination) : undefined,
          epochSponsor: epochEvmAddress,
        });
        activityId = optimistic.id;
        const withNew = [optimistic, ...activities];
        setActivities(withNew);
        saveActivities(withNew);
        router.push(`/activity/${optimistic.id}`);

        const result = await runEpochTransfer({
          mode,
          amount,
          midenAccount: epochMidenAccount,
          evmAddress: epochEvmAddress,
          requestSend: midenWallet.requestSend,
          waitForTransaction: midenWallet.waitForTransaction,
          onStatus: (status) => {
            // Reflect live phase progress on the detail page (via the row's eta),
            // and capture the deposit tx hash if/when the SDK provides it.
            const patch: Partial<Activity> = {
              eta: EPOCH_PHASE_LABEL[status.phase] ?? "Working…",
            };
            if (isSepoliaTxHash(status.transactionHash)) {
              patch.status = "message_observed";
              patch.txHash = shortAddress(status.transactionHash);
              patch.sourceTxHash = status.transactionHash;
            }
            patchStoredActivity(optimistic.id, patch);
            setActivities(loadStoredActivities());
          },
        });

        // Final details — the intent nonce starts the detail-page status poll.
        patchStoredActivity(optimistic.id, {
          status: "message_observed",
          eta: "1-3 min",
          txHash: result.sourceTxHash
            ? shortAddress(result.sourceTxHash)
            : "0xpending",
          sourceTxHash: result.sourceTxHash,
          midenTxId: mode === "send" ? result.midenNoteId : undefined,
          epochIntentNonce: result.intentNonce,
          epochSponsor: result.sponsorAddress,
          receivedAmount: result.outputAmount
            ? `${result.outputAmount} USDC`
            : undefined,
        });
        setActivities(loadStoredActivities());
      } catch (error) {
        if (activityId) {
          if (isUserRejection(error)) {
            // Nothing was submitted — drop the optimistic row and return to the
            // form so the cancellation doesn't leave a stuck "preparing" row.
            const remaining = loadStoredActivities().filter(
              (item) => item.id !== activityId,
            );
            saveActivities(remaining);
            setActivities(remaining);
            router.push("/");
          } else {
            // Errored mid-transfer — keep the row but mark it failed.
            patchStoredActivity(activityId, {
              status: "failed",
              eta: "Transfer failed",
            });
            setActivities(loadStoredActivities());
          }
        }
        setBridgeError(errorMessage(error));
      } finally {
        setIsSubmitting(false);
        setSubmitPhase("");
      }
      return;
    }

    const resolvedDestination =
      destination.trim() || (mode === "receive" ? midenAddress : walletAccount);
    const next = createActivity(mode, provider, amount, {
      destination: resolvedDestination,
    });
    const updated = [next, ...activities];
    setActivities(updated);
    saveActivities(updated);
    router.push(`/activity/${next.id}`);
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

        <div
          className="wallet-cluster"
          aria-label="Connected wallets"
          ref={walletClusterRef}
        >
          <div className="wallet-menu-root" ref={evmMenuRef}>
            <button
              className={`wallet-button wallet-pill ${walletConnected ? "connected" : ""} ${wrongNetwork ? "wrong-network" : ""}`}
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
              <div
                className={`wallet-actions-menu ${evmMenuOpen ? "open" : ""}`}
                role="menu"
              >
                <div className="wallet-menu-summary">
                  <span className="wallet-menu-avatar connected">
                    <Wallet size={16} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{evmWalletLabel}</strong>
                    <small>
                      {shortAddress(walletAccount)} · {evmBalanceText}
                    </small>
                  </span>
                </div>
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
                  onClick={switchSepoliaFromMenu}
                >
                  <RefreshCcw size={15} aria-hidden="true" />
                  <span>Switch to Sepolia</span>
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
                  href={`${AGGLAYER_BALI.sepoliaExplorer}/address/${walletAccount}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={15} aria-hidden="true" />
                  <span>View on Etherscan</span>
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
              </div>
            ) : null}
          </div>

          <MidenWalletButton onStateChange={handleMidenWalletState} />
        </div>
      </header>
      {midenWallet.error ? (
        <p className="form-error topbar-error">{midenWallet.error}</p>
      ) : null}

      <section className="swap-stage">
        <section className="swap-card" aria-label="Miden bridge">
          <div className="swap-card-top">
            <h1>Bridge</h1>
            <div className="route-menu-root" ref={routeMenuRef}>
              <button
                className="route-trigger"
                type="button"
                aria-expanded={routeMenuOpen}
                aria-haspopup="listbox"
                onClick={() => setRouteMenuOpen((open) => !open)}
              >
                <span>Route</span>
                <strong>{providerCopy.label}</strong>
                <ChevronDown size={15} aria-hidden="true" />
              </button>

              {routeMenuOpen ? (
                <div
                  className="route-options-menu open"
                  role="listbox"
                  aria-label="Bridge route"
                  onKeyDown={handleRouteMenuKeyDown}
                >
                  {(Object.keys(providers) as BridgeProvider[]).map((key) => {
                    const option = providers[key];
                    const c = option.comparison;
                    const selected = key === provider;
                    const disabled = option.disabled === true;
                    return (
                      <button
                        className={`route-option ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-disabled={disabled}
                        disabled={disabled}
                        key={key}
                        onClick={() => selectRouteOption(key)}
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
                          {c.asset} · {c.eta}
                        </span>
                        {disabled && c.unavailableReason ? (
                          <small className="route-unavailable">
                            {c.unavailableReason}
                          </small>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          {/* Keep the active route legible without reopening the menu: provider
              is on the trigger; asset + ETA + persistent Testnet status here. */}
          <div className="route-status-line" aria-label="Selected route summary">
            <span className={`route-pill ${routeTone}`}>
              {providerCopy.badge}
            </span>
            <span className="route-pill">{quote.eta}</span>
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
                onClick={() => selectMode(item)}
              >
                {modes[item].label}
              </button>
            ))}
          </div>

          <div className="swap-box swap-fade" key={`from-${mode}-${provider}`}>
            <div>
              <span>From</span>
              <strong>{copy.from}</strong>
              {renderWalletChip(sourceIdentity)}
              {(() => {
                const line =
                  mode === "send" ? renderMidenBalance() : renderEvmBalance();
                return line ? (
                  <small className="balance-line">{line}</small>
                ) : null;
              })()}
            </div>
            <label>
              <input
                aria-label="Amount"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <TokenSelect
                provider={provider}
                onSelectProvider={selectRouteOption}
              />
            </label>
          </div>

          <div className="swap-divider" aria-hidden="true">
            <ArrowDown size={18} />
          </div>

          <div className="swap-box swap-fade" key={`to-${mode}-${provider}`}>
            <div>
              <span>To</span>
              <strong>{copy.to}</strong>
              {renderWalletChip(destinationIdentity)}
              {(() => {
                const line =
                  mode === "receive" ? renderMidenBalance() : renderEvmBalance();
                return line ? (
                  <small className="balance-line">{line}</small>
                ) : null;
              })()}
            </div>
            <label className="readonly-amount">
              <strong>
                {provider === "epoch" ? (
                  <EpochQuotePreview
                    mode={mode}
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
              <TokenSelect
                provider={provider}
                onSelectProvider={selectRouteOption}
              />
            </label>
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
          {bridgeError ? <p className="form-error">{bridgeError}</p> : null}

          <div
            className="quote-summary swap-fade"
            aria-label="Route quote"
            key={`qs-${mode}-${provider}`}
          >
            <div>
              <span>ETA</span>
              <strong>{quote.eta}</strong>
            </div>
            <div>
              <span>Min received</span>
              <strong>{displayMinReceived}</strong>
            </div>
            <div>
              <span>Network fee</span>
              <strong>{networkFeeDisplay}</strong>
            </div>
          </div>

          {/* Material route warning belongs before the CTA, not only in a
              footnote after it — the user should read the testnet/route caveat
              before committing funds. */}
          <div className={`route-disclaimer ${routeTone}`} role="note">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>{routeNote}</span>
          </div>

          <button
            className="primary-button"
            type="button"
            onClick={handlePrimaryAction}
            disabled={cta.disabled}
          >
            {cta.label}
            {isSubmitting ? (
              <RefreshCcw size={18} className="animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRight size={18} aria-hidden="true" />
            )}
          </button>
          {showPreflight ? (
            <div
              className="preflight-overlay"
              role="dialog"
              aria-modal="true"
              aria-label={`Review ${mode === "receive" ? "receive" : "send"}`}
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
                      {amount} {provider === "epoch" ? "USDC" : copy.assetIn}
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
                        className={showFullDestination ? "full" : undefined}
                        title={previewDestination}
                      >
                        {showFullDestination
                          ? previewDestination
                          : shortAddress(previewDestination)}
                      </span>
                      {previewDestination.length > 16 ? (
                        <button
                          type="button"
                          className="preflight-inspect"
                          onClick={() =>
                            setShowFullDestination((shown) => !shown)
                          }
                        >
                          {showFullDestination ? "Hide" : "Show full"}
                        </button>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt>Route</dt>
                    <dd>{providerCopy.label}</dd>
                  </div>
                  <div>
                    <dt>ETA</dt>
                    <dd>{quote.eta}</dd>
                  </div>
                  <div>
                    <dt>Network fee</dt>
                    <dd>{networkFeeDisplay}</dd>
                  </div>
                  <div>
                    <dt>Provider fee</dt>
                    <dd>{quote.bridgeFee}</dd>
                  </div>
                </dl>

                <p className="preflight-note">{routeNote}</p>

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
                    <small><RelativeTime at={activity.updatedAt} /></small>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>
        )}

        {pastActivities.length > 0 && (
          <section className="home-activity" aria-label="Recent transfers">
            <div className="home-activity-title">
              <h2>Recent transfers</h2>
            </div>
            <div className="home-activity-list">
              {pastActivities.map((activity) => (
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
                    <small><RelativeTime at={activity.updatedAt} /></small>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
