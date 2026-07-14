"use client";

import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  LogOut,
  RefreshCcw,
  Wallet,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  createActivity,
  loadStoredActivities,
  modes,
  providers,
  quoteFor,
  saveActivities,
  shortAddress,
  statusLabel,
  statusTone,
  walletGradient,
} from "../lib/bridge-state";
import { sepoliaGasUnitsFor, useSepoliaGasEstimate } from "../lib/sepolia-gas";
import {
  useAppKit,
  useAppKitAccount,
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
  const [midenBalanceFetchedFor, setMidenBalanceFetchedFor] = useState("");
  // Live Epoch API quote amount, lifted from EpochQuotePreview so the
  // Min-received detail reflects the real quote (not a hardcoded estimate).
  const [epochQuoteAmount, setEpochQuoteAmount] = useState<string | undefined>(
    undefined,
  );
  const midenBalanceInflightRef = useRef<Promise<
    Record<string, string>
  > | null>(null);
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
  // The received-token unit for the "To" box pill: Epoch bridges USDC, AggLayer ETH.
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
  // AggLayer outbound (Miden→Sepolia): builds a B2AGG bridge-out note via the
  // SDK (Note.createB2AggNote) and submits it through the MidenFi wallet.
  const isLiveAgglayerSend = provider === "agglayer" && mode === "send";

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
  const sourceBalance = mode === "receive" ? evmBalanceText : midenBalanceText;
  const destinationBalance =
    mode === "receive" ? midenBalanceText : evmBalanceText;
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
      ? "NEAR Intents is paused in this build while AggLayer and Epoch are the active testnet routes."
      : provider === "agglayer"
        ? mode === "receive"
          ? "Slow testnet route. Your Sepolia wallet sends to Miden through AggLayer with no provider bridge fee."
          : "Bridge out from Miden through AggLayer. The Sepolia claim is auto-submitted once the exit settles (~30-90 min)."
        : "Testnet route. Epoch integration status is tracked from activity details.";
  const primaryActionLabel = isSubmitting
    ? submitPhase || "Preparing…"
    : insufficientBalance
      ? `Not enough ${sourceTokenSymbol}`
      : mode === "send" && !midenWallet.connected
      ? "Connect Miden wallet"
      : isLiveAgglayerSend
        ? "Bridge out to Sepolia"
      : isLiveAgglayerReceive && !walletConnected
      ? "Connect Sepolia wallet"
      : isLiveAgglayerReceive && !hasDestination
        ? "Add Miden account"
        : isLiveAgglayerReceive
          ? "Receive on Miden"
          : mode === "receive"
            ? "Start receive"
            : "Start send";
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
    const resolvedMode = nextMode ?? "receive";

    queueMicrotask(() => {
      if (nextProvider && !providers[nextProvider].disabled)
        setProvider(nextProvider);
      if (nextMode) setMode(nextMode);

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

  useEffect(() => {
    if (!walletAccount) return;

    let cancelled = false;
    // Show the balance of the token this route actually moves on Sepolia:
    // Epoch bridges USDC, AggLayer bridges native ETH.
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
      setMidenBalanceFetchedFor("");
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    // Connected but the adapter's requestAssets/address hasn't settled yet — wait
    // rather than resetting (a transient undefined must not re-trigger the popup).
    if (!requestMidenAssets || !midenAddress) return;
    if (midenBalanceFetchedFor === midenAddress) return;

    let cancelled = false;
    const run =
      midenBalanceInflightRef.current ??
      (midenBalanceInflightRef.current = (async () => {
        const { fetchMidenBalances } = await import("../lib/miden-balance");
        return fetchMidenBalances(
          requestMidenAssets,
          Object.entries(MIDEN_ROUTE_TOKEN).map(([key, t]) => ({
            key,
            faucetId: t.faucetId,
            decimals: t.decimals,
          })),
        );
      })());

    run
      .then((balances) => {
        if (cancelled) return;
        setMidenBalances(balances);
        setMidenBalanceFetchedFor(midenAddress);
      })
      .catch(() => {
        if (!cancelled) setMidenBalances(null);
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
  ]);

  function selectMode(nextMode: FlowMode) {
    setMode(nextMode);
    setAmount("");
    setDestination("");
    destinationPrefilledRef.current = false;
    setBridgeError("");
  }

  // Re-sync the Miden balance (opens a fresh requestAssets popup by clearing the
  // fetched marker so the balance effect re-runs).
  function refreshMidenBalance() {
    midenBalanceInflightRef.current = null;
    setMidenBalanceFetchedFor("");
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

  function selectProvider(nextProvider: BridgeProvider) {
    if (providers[nextProvider].disabled) return;
    setProvider(nextProvider);
    setBridgeError("");
    // Destination is route-agnostic: the connected Miden wallet address (bech32)
    // prefills for both routes and the AggLayer submit normalizes it to hex — so
    // AggLayer behaves exactly like Epoch (no special clearing here).
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

  async function switchSepoliaFromMenu() {
    try {
      if (!walletProvider) throw new Error("Connect your EVM wallet first.");
      await ensureSepolia(walletProvider);
      setEvmMenuOpen(false);
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
    // Every send signs on Miden (Epoch send + AggLayer bridge-out) — require the
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
      let unitsAmount: bigint;
      try {
        unitsAmount = parseUnits(amount, AGGLAYER_BALI.midenEthDecimals);
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
        const { txId } = await runAgglayerSend({
          amount: unitsAmount,
          destinationAddress,
          senderAddress,
          requestTransaction: midenWallet.requestTransaction,
          waitForTransaction: midenWallet.waitForTransaction,
        });
        // Note submitted on Miden; AggLayer hasn't observed the exit yet.
        const activity = createActivity(mode, provider, amount, {
          status: "source_finality",
          eta: "30-90 min",
          destination: destinationAddress,
          // origin = Miden rollup 78, destination = Ethereum L1 (0)
          sourceNetworkId: AGGLAYER_BALI.destinationNetworkId,
          destinationNetworkId: AGGLAYER_BALI.sourceNetworkId,
          midenTxId: txId,
        });
        const updated = [activity, ...activities];
        setActivities(updated);
        saveActivities(updated);
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
          eta: "About 15 min",
          destination: destinationAccount,
          bridgeDestinationAddress: transaction.destinationAddress,
          midenTxId: transaction.destinationAddress,
          sourceNetworkId: AGGLAYER_BALI.sourceNetworkId,
          destinationNetworkId: AGGLAYER_BALI.destinationNetworkId,
          txHash: shortAddress(txHash),
          sourceTxHash: txHash,
        });
        const updated = [activity, ...activities];
        setActivities(updated);
        saveActivities(updated);
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
      try {
        // Submit first (wallet approval + intent broadcast happen here), then
        // record the activity row only once the transfer actually goes through.
        // Dynamic import: epoch-execute pulls eager-WASM miden-sdk, so it must
        // load client-side at click time, never in the server render.
        const { runEpochTransfer } = await import("../lib/epoch/epoch-execute");
        const result = await runEpochTransfer({
          mode,
          amount,
          midenAccount: epochMidenAccount,
          evmAddress: epochEvmAddress,
          requestSend: midenWallet.requestSend,
          waitForTransaction: midenWallet.waitForTransaction,
          // Surface the SDK's approve/deposit/batch phases on the button.
          onStatus: (phase) =>
            setSubmitPhase(EPOCH_PHASE_LABEL[phase] ?? "Working…"),
        });
        const activity = createActivity(mode, "epoch", amount, {
          status: "message_observed",
          eta: "1-3 min",
          destination: resolvedDestination,
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
        const updated = [activity, ...activities];
        setActivities(updated);
        saveActivities(updated);
      } catch (error) {
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

        <div className="wallet-cluster" aria-label="Connected wallets">
          <div className="wallet-menu-root" ref={evmMenuRef}>
            <button
              className={`wallet-button wallet-pill ${walletConnected ? "connected" : ""}`}
              type="button"
              onClick={handleEvmWalletClick}
              aria-expanded={walletConnected ? evmMenuOpen : undefined}
              aria-haspopup={walletConnected ? "menu" : undefined}
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
              <span className="wallet-pill-label">
                {walletConnected
                  ? shortAddress(walletAccount)
                  : "Connect wallet"}
              </span>
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
                >
                  {(Object.keys(providers) as BridgeProvider[])
                    .filter((key) => !providers[key].disabled)
                    .map((key) => {
                    const option = providers[key];
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
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.badge}</small>
                        </span>
                        <em>{option.route}</em>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
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
              <small className="balance-line">
                Available {sourceBalance}
                {mode === "send" && midenWallet.connected ? (
                  <button
                    type="button"
                    className="balance-refresh"
                    onClick={refreshMidenBalance}
                    aria-label="Refresh Miden balance"
                    title="Refresh Miden balance"
                  >
                    <RefreshCcw size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </small>
            </div>
            <label>
              <input
                aria-label="Amount"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              {/* Epoch's SIO route bridges USDC<->USDC; the shared `assetIn`
                  label ("ETH") is only correct for AggLayer. */}
              <span>{provider === "epoch" ? "USDC" : copy.assetIn}</span>
            </label>
          </div>

          <div className="swap-divider" aria-hidden="true">
            <ArrowDown size={18} />
          </div>

          <div className="swap-box swap-fade" key={`to-${mode}-${provider}`}>
            <div>
              <span>To</span>
              <strong>{copy.to}</strong>
              <small className="balance-line">
                Available {destinationBalance}
                {mode === "receive" && midenWallet.connected ? (
                  <button
                    type="button"
                    className="balance-refresh"
                    onClick={refreshMidenBalance}
                    aria-label="Refresh Miden balance"
                    title="Refresh Miden balance"
                  >
                    <RefreshCcw size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </small>
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
                  />
                ) : (
                  expectedReceivedAmount
                )}
              </strong>
              <span>{destinationSymbol}</span>
            </label>
          </div>

          <label className="destination-input">
            <span>{copy.destinationLabel}</span>
            <input
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

          <button
            className="primary-button"
            type="button"
            onClick={submitTransfer}
            disabled={isSubmitting || insufficientBalance}
          >
            {primaryActionLabel}
            {isSubmitting ? (
              <RefreshCcw size={18} className="animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRight size={18} aria-hidden="true" />
            )}
          </button>

          <div className={`route-disclaimer ${routeTone}`}>
            <span>{routeNote}</span>
          </div>
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
                    <small>{activity.updatedAt}</small>
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
