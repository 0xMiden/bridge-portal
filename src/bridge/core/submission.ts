import type { TransferQuote } from "./quote";
import type { MessageSignerWalletAdapter } from "@miden-sdk/miden-wallet-adapter-base";
import type { ResolvedMidenAsset } from "../miden-balances";
import type { EvmProvider } from "../../wallets/evm/evm-wallet";
import type { Activity } from "./models";
import type { BridgeRoute } from "./routes";
import type { ActivityStore } from "../activity";

export interface TransferSubmission {
  environment?: import("../../config/environment").BridgeEnvironment;
  routeId: string;
  quote?: TransferQuote;
  amount: string;
  insufficientBalance: boolean;
  evmBalance: string;
  evmWallet: {
    connected: boolean;
    address: string;
    provider?: EvmProvider;
  };
  midenWallet: {
    connected: boolean;
    /** Current connected account, also used for the transfer recipient. */
    address: string;
    requestTransaction?: MessageSignerWalletAdapter["requestTransaction"];
    waitForTransaction?: MessageSignerWalletAdapter["waitForTransaction"];
  };
  midenAsset: ResolvedMidenAsset | null;
  /** Resolved directional accounts shared by quoting and submission. */
  evmAddress: string;
  midenAccount: string;
}

export interface SubmissionEffects {
  openEvmWallet: () => Promise<unknown>;
  /** Fresh account valuation before a bridge-in can reach a signing flow. */
  verifyBalanceCap?: (route: BridgeRoute, amount: string, account: string) => Promise<void>;
  onError: (message: string) => void;
  onSubmittingChange: (submitting: boolean) => void;
  onPhaseChange: (phase: string) => void;
  activities: Pick<ActivityStore, "record" | "patch">;
  navigate: (path: string) => void;
}

export type SubmissionContext = {
  input: TransferSubmission;
  route: BridgeRoute;
  phase: (message: string) => void;
  /** Retain a receipt only after the provider acknowledges the source submission. */
  record: (patch: Partial<Activity>) => Activity;
  update: (patch: Partial<Activity>) => void;
};
