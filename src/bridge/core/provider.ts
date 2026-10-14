import type { ActivityStatus } from "./activity-status";
import type { ActivityGuidance, ActivityStep } from "./activity-presentation";
import type { Activity, BridgeActivity, FlowMode } from "./models";
import type { BridgeRoute } from "./routes";
import type { QuoteRequest, QuoteResult } from "./quote";
import type { SubmissionContext } from "./submission";

export type PhaseDefinition = {
  /** Progress order within this provider and direction; terminal phases are handled separately. */
  order: number;
  status: ActivityStatus;
  headline: string;
  guidance?: ActivityGuidance;
  message?: string;
  failureLeg?: "source" | "destination";
};

export type FeePolicy = {
  charging: "none" | "included" | "additional" | "deducted";
  requiresQuote: boolean;
  label: string;
  estimated: boolean;
  output: "exact" | "unquoted";
  eta: string;
  showEta: boolean;
  networkFee: string;
  bridgeFee: string;
  warning: string;
  sepoliaGasUnits: number | null;
};

export type ProviderDirection = {
  steps: readonly ActivityStep[];
  phases: Readonly<Record<string, PhaseDefinition>>;
  phaseFields: readonly (keyof BridgeActivity)[];
  resolvePhase: (activity: BridgeActivity) => string;
  consumeNote: boolean;
  tracking: "automatic" | "manual";
  pollMs: number;
  deliveryWarningMs?: number;
  fees: (route?: BridgeRoute) => FeePolicy;
  activityDetails: (activity: BridgeActivity) => ActivityDetails;
};

/** Provider facts consumed by the shared receipt and progress components. */
export type ActivityDetails = {
  sourceHash?: string;
  destinationHash?: string;
  destinationKind: "tx" | "note";
  received?: string;
  fee?: string;
  reference?: { label: string; value: string };
  destinationBlock?: number;
};

export type ActivityObservation = {
  patch: Partial<Activity>;
  warning?: string;
};

export type ActivityMonitor = {
  canPoll: (activity: Activity) => boolean;
  observe: (activity: Activity, signal: AbortSignal) => Promise<ActivityObservation>;
};

/** Both directions expose the same operations, including unavailable/manual ones. */
export type ProviderFlows = Record<
  FlowMode,
  {
    quote: (input: QuoteRequest, signal: AbortSignal) => Promise<QuoteResult | null>;
    submit: (context: SubmissionContext) => Promise<void>;
    monitor: ActivityMonitor;
  }
>;

export type Provider = {
  label: string;
  badge: string;
  disabled?: boolean;
  unavailableReason?: string;
  directions: ProviderDirections;
  load: () => Promise<{ flows: ProviderFlows }>;
};

export type ProviderDirections = Record<FlowMode, ProviderDirection>;

export const activityPhase = (activity: BridgeActivity) => activity.status;
