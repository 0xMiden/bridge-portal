import { parseUnits } from "viem";
import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import type { BridgeProvider, FlowMode } from "../../bridge/core/models";
import type { ResolvedEthAsset } from "../../bridge/miden-route-balances";
import {
  AGGLAYER_BALI,
  buildSepoliaDepositTransaction,
  normalizeMidenAccountHex,
} from "../../bridge/providers/agglayer/agglayer";
import { type EvmProvider, ensureSepolia } from "../../wallets/evm/evm-wallet";
import { shortAddress } from "../../wallets/identity";
import { type Activity, createActivity, providers } from "./bridge-presentation";
import { loadStoredActivities, patchStoredActivity, saveActivities } from "./bridge-persistence";
import { errorMessage, isUserRejection } from "./wallet-errors";

export interface TransferSubmission {
  provider: BridgeProvider;
  mode: FlowMode;
  amount: string;
  destination: string;
  activities: Activity[];
  insufficientBalance: boolean;
  sourceTokenSymbol: string;
  evmBalance: string;
  evmWallet: {
    connected: boolean;
    address: string;
    provider?: EvmProvider;
  };
  midenWallet: {
    connected: boolean;
    /** Connected or wallet-launch account, matching the form's resolved address. */
    address: string;
    requestTransaction?: MidenFiWalletContextState["requestTransaction"];
    waitForTransaction?: MidenFiWalletContextState["waitForTransaction"];
  };
  agglayerEth: ResolvedEthAsset | null;
  /** The same directional accounts used by the form's live Epoch quote. */
  epochEvmAddress: string;
  epochMidenAccount: string;
}

export interface SubmissionEffects {
  openEvmWallet: () => Promise<unknown>;
  onError: (message: string) => void;
  onSubmittingChange: (submitting: boolean) => void;
  onPhaseChange: (phase: string) => void;
  onActivitiesChange: (activities: Activity[]) => void;
  navigate: (path: string) => void;
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

// Warm the client-only execution chunks ahead of the wallet prompt.
let epochExecutePreload: Promise<unknown> | null = null;
let agglayerExecutePreload: Promise<unknown> | null = null;

export function preloadBridgeSubmission(provider: BridgeProvider) {
  if (provider === "epoch") {
    epochExecutePreload ??= import("../../bridge/providers/epoch/epoch-execute");
  } else if (provider === "agglayer") {
    agglayerExecutePreload ??= import("../../bridge/providers/agglayer/agglayer-execute");
  }
}

/**
 * Submit from a snapshot of the reviewed form. Persistence continues after
 * navigation, so Epoch progress does not depend on the form staying mounted.
 * Provider execution modules remain dynamically loaded for their browser-only WASM.
 */
export async function submitBridgeTransfer(
  input: TransferSubmission,
  effects: SubmissionEffects,
): Promise<void> {
  const {
    provider,
    mode,
    amount,
    destination,
    activities,
    insufficientBalance,
    sourceTokenSymbol,
    evmBalance,
    midenWallet,
    agglayerEth,
    epochEvmAddress,
    epochMidenAccount,
  } = input;
  const {
    connected: walletConnected,
    address: walletAccount,
    provider: walletProvider,
  } = input.evmWallet;
  const midenAddress = midenWallet.address;
  const {
    openEvmWallet,
    onError,
    onSubmittingChange,
    onPhaseChange,
    onActivitiesChange,
    navigate,
  } = effects;

  if (providers[provider].disabled) {
    onError("This route isn't available in this build.");
    return;
  }
  // Guard the deposit before opening the wallet: a request above the Sepolia
  // balance reverts on-chain (MetaMask "likely to fail").
  if (insufficientBalance) {
    onError(
      `Not enough ${sourceTokenSymbol} — this wallet holds ${evmBalance}. Lower the amount.`,
    );
    return;
  }
  // Every send signs on Miden (Epoch send + Agglayer bridge-out) — require the
  // MidenFi wallet up front so the CTA and error are clear (not a late throw).
  if (mode === "send" && !midenWallet.connected) {
    onError("Connect your Bread wallet to sign the send.");
    return;
  }

  if (provider === "agglayer" && mode === "send") {
    onSubmittingChange(true);
    const senderAddress = midenAddress;
    if (
      !midenWallet.connected ||
      !midenWallet.requestTransaction ||
      !midenWallet.waitForTransaction ||
      !senderAddress
    ) {
      onError(
        "Connect your Bread wallet before bridging out to Sepolia.",
      );
      onSubmittingChange(false);
      return;
    }
    const destinationAddress = destination.trim() || walletAccount;
    if (!/^0x[0-9a-fA-F]{40}$/.test(destinationAddress)) {
      onError(
        "Enter a valid Sepolia (0x…) destination, or connect your Sepolia wallet.",
      );
      onSubmittingChange(false);
      return;
    }
    // The wrapped-ETH faucet + its decimals are resolved from the wallet's
    // held asset (Show balance) — there's no hardcodeable id. Require it so we
    // burn the exact token the user holds, at its real precision.
    if (!agglayerEth) {
      onError(
        'Tap "Show balance" first so we can detect the Miden ETH you\'re sending.',
      );
      onSubmittingChange(false);
      return;
    }
    let unitsAmount: bigint;
    try {
      unitsAmount = parseUnits(amount, agglayerEth.decimals);
    } catch {
      onError("Enter a valid amount.");
      onSubmittingChange(false);
      return;
    }
    if (unitsAmount <= BigInt(0)) {
      onError("Enter an amount greater than zero.");
      onSubmittingChange(false);
      return;
    }

    onPhaseChange("Preparing bridge note…");
    try {
      // Submit first — the wallet approval + note proving happen here. Only
      // once the send actually goes through do we record an activity row.
      // Dynamic import: agglayer-execute pulls the eager-WASM SDK + wallet
      // adapter, so it must load client-side at click time, never in SSR.
      const { runAgglayerSend } = await import("../../bridge/providers/agglayer/agglayer-execute");
      onPhaseChange("Confirm in your wallet…");
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
        // origin = configured Miden rollup, destination = Ethereum L1 (0)
        sourceNetworkId: AGGLAYER_BALI.destinationNetworkId,
        destinationNetworkId: AGGLAYER_BALI.sourceNetworkId,
        // The real on-chain Miden tx hash (not the wallet request UUID) — this
        // feeds the Midenscan /tx/ deep link on the send detail page.
        midenTxId: txHash,
      });
      const updated = [activity, ...activities];
      onActivitiesChange(updated);
      saveActivities(updated);
      navigate(`/activity/${activity.id}`);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      onSubmittingChange(false);
      onPhaseChange("");
    }
    return;
  }

  if (provider === "agglayer" && mode === "receive") {
    onSubmittingChange(true);
    if (!walletConnected || !walletProvider || !walletAccount) {
      await openEvmWallet();
      onSubmittingChange(false);
      return;
    }
    const account = walletAccount;
    const destinationAccount = destination.trim() || midenAddress;
    if (!destinationAccount) {
      onError(
        "Connect Bread or paste a Miden account ID before receiving.",
      );
      onSubmittingChange(false);
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
      onError(errorMessage(error));
      onSubmittingChange(false);
      return;
    }

    onPhaseChange("Confirm in your wallet…");
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
      onPhaseChange("Submitting…");
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
      onActivitiesChange(updated);
      saveActivities(updated);
      navigate(`/activity/${activity.id}`);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      onSubmittingChange(false);
      onPhaseChange("");
    }
    return;
  }

  if (provider === "epoch") {
    onSubmittingChange(true);
    // Receive (EVM→Miden) signs a Sepolia deposit, so it needs a connected
    // EVM wallet on Sepolia. Send (Miden→EVM) signs only on Miden.
    if (mode === "receive") {
      if (!walletConnected || !walletProvider || !walletAccount) {
        await openEvmWallet();
        onSubmittingChange(false);
        return;
      }
      try {
        await ensureSepolia(walletProvider);
      } catch (error) {
        onError(errorMessage(error));
        onSubmittingChange(false);
        return;
      }
    }

    const resolvedDestination =
      mode === "send" ? epochEvmAddress : epochMidenAccount;
    // Require a valid recipient before starting, so a missing destination
    // doesn't create a failed ("Needs recovery") activity.
    if (mode === "receive" && !resolvedDestination) {
      onError(
        "Connect your Bread wallet or paste a Miden account to receive into.",
      );
      onSubmittingChange(false);
      return;
    }
    if (
      mode === "send" &&
      !/^0x[0-9a-fA-F]{40}$/.test(resolvedDestination)
    ) {
      onError(
        "Enter a valid Sepolia (0x…) address, or connect your Sepolia wallet.",
      );
      onSubmittingChange(false);
      return;
    }
    onPhaseChange(
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
      const { runEpochTransfer } = await import("../../bridge/providers/epoch/epoch-execute");

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
      onActivitiesChange(withNew);
      saveActivities(withNew);
      navigate(`/activity/${optimistic.id}`);

      const result = await runEpochTransfer({
        mode,
        amount,
        midenAccount: epochMidenAccount,
        evmAddress: epochEvmAddress,
        requestTransaction: midenWallet.requestTransaction,
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
          onActivitiesChange(loadStoredActivities());
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
        receivedAmount: result.outputAmount,
      });
      onActivitiesChange(loadStoredActivities());
    } catch (error) {
      if (activityId) {
        if (isUserRejection(error)) {
          // Nothing was submitted — drop the optimistic row and return to the
          // form so the cancellation doesn't leave a stuck "preparing" row.
          const remaining = loadStoredActivities().filter(
            (item) => item.id !== activityId,
          );
          saveActivities(remaining);
          onActivitiesChange(remaining);
          navigate("/");
        } else {
          // Errored mid-transfer — keep the row but mark it failed.
          patchStoredActivity(activityId, {
            status: "failed",
            eta: "Transfer failed",
          });
          onActivitiesChange(loadStoredActivities());
        }
      }
      onError(errorMessage(error));
    } finally {
      onSubmittingChange(false);
      onPhaseChange("");
    }
    return;
  }

  const resolvedDestination =
    destination.trim() || (mode === "receive" ? midenAddress : walletAccount);
  const next = createActivity(mode, provider, amount, {
    destination: resolvedDestination,
  });
  const updated = [next, ...activities];
  onActivitiesChange(updated);
  saveActivities(updated);
  navigate(`/activity/${next.id}`);
}
