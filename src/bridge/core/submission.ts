import type { TransferQuote } from "./quote";
import type { MessageSignerWalletAdapter } from "@miden-sdk/miden-wallet-adapter-base";
import type { ResolvedMidenAsset } from "../miden-balances";
import type { ExternalWallet } from "../../wallets/bridge-wallet";
import type { TransferAccounts } from "./accounts";
import type { Activity } from "./models";
import type { BridgeRoute } from "./routes";
import type { ActivityStore } from "../activity";

export interface TransferSubmission extends TransferAccounts {
  environment?: import("../../config/environment").BridgeEnvironment;
  routeId: string;
  quote?: TransferQuote;
  amount: string;
  insufficientBalance: boolean;
  sourceBalance: string;
  externalWallet: ExternalWallet;
  midenWallet: {
    connected: boolean;
    /** Current connected account, also used for the transfer recipient. */
    address: string;
    requestTransaction?: MessageSignerWalletAdapter["requestTransaction"];
    waitForTransaction?: MessageSignerWalletAdapter["waitForTransaction"];
    requestAssets?: MessageSignerWalletAdapter["requestAssets"];
  };
  midenAsset: ResolvedMidenAsset | null;
}

export interface SubmissionEffects {
  openExternalWallet: () => Promise<unknown>;
  /** Fresh account valuation before a bridge-in can reach a signing flow. */
  verifyBalanceCap?: (route: BridgeRoute, amount: string, account: string) => Promise<void>;
  onError: (message: string) => void;
  onSubmittingChange: (submitting: boolean) => void;
  onPhaseChange: (phase: string) => void;
  activities: Pick<ActivityStore, "record" | "patch"> & Partial<Pick<ActivityStore, "get" | "sync">>;
  navigate: (path: string) => void;
}

export type SubmissionContext = {
  input: TransferSubmission;
  route: BridgeRoute;
  phase: (message: string) => void;
  /** Retain a receipt only after the provider acknowledges the source submission. */
  record: (patch: Partial<Activity>) => Activity;
  /** Require durable storage before asking a wallet to fund a NEAR quote. */
  persist: (patch: Partial<Activity>) => Promise<Activity>;
  findActivity: (id: string) => Promise<Activity | undefined>;
  update: (patch: Partial<Activity>) => void;
};
