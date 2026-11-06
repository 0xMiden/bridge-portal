import { formatUnits } from "viem";
import { getHelperDeployment, solanaSignature, type HelperDeployment } from "../../../config/cctp-helper";
import { currentBridgeConfig } from "../../../config/bridge-config";
import { createActivity } from "../../../app/lib/bridge-presentation";
import type { Activity } from "../../core/models";
import type { BridgeRoute } from "../../core/routes";
import { decodeArcRecipient } from "./attestation";
import { manualObservationSchema, helperActivitySchema, type ManualSourceEvidence } from "./helper-types";
import { sameHelperDeployment, validateSavedHelperSource } from "./helper-manual";

function matchesSavedSource(activity: Activity, source: ManualSourceEvidence, deploymentId: string) {
  const helper = activity.cctpHelper;
  if (!helper) return false;
  const auth = helper.authorization;
  if (auth.deploymentId !== deploymentId || helper.eventAccount !== source.eventAccount) return false;
  const fields = ["sourceAccount", "grossAmount", "maxCctpFee", "midenRecipient"] as const;
  if (fields.some(field => auth[field] !== source[field])) return false;
  return BigInt(source.slot) >= BigInt(helper.scanStartSlot);
}
async function readRecoveredSource(deploymentId: string, signature: string) {
  solanaSignature.parse(signature);
  const response = await fetch("/api/cctp-helper/manual/attestation", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000), headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 2, deploymentId, sourceTransaction: signature, recoverSource: true }) });
  if (!response.ok) throw new Error("Finalized source history is unavailable. Keep the original signature; do not burn again.");
  const observed = manualObservationSchema.parse(await response.json());
  if (observed.state !== "source_verified") throw new Error("Import requires one finalized successful source occurrence. Missing or failed history cannot resolve another attempt.");
  if (observed.source.sourceTransaction !== signature) throw new Error("Recovery returned a different source signature.");
  return observed.source;
}
function bindSavedSource(saved: Activity, source: ManualSourceEvidence, deployment: HelperDeployment): Activity {
  const helper = saved.cctpHelper;
  if (!helper || !matchesSavedSource(saved, source, deployment.deploymentId)) throw new Error("Signature does not match the preserved source attempt.");
  if (!sameHelperDeployment(helper.authorization.deployment, deployment) || helper.stage === "source_failed") throw new Error("Preserved deployment/source proof disagrees with recovery.");
  if (helper.signature && helper.signature !== source.sourceTransaction) throw new Error("Preserved source signature differs.");
  return { ...saved, sourceTxHash: source.sourceTransaction, cctpHelper: { ...helper, signature: source.sourceTransaction, sourceEvidence: source, signedBytes: undefined,
    stage: helper.completion ? helper.stage : "source_finalized" } };
}
function recoveryRoute(deployment: HelperDeployment): BridgeRoute {
  return { id: `${deployment.environment}:cctp-helper-solana-manual:${deployment.deploymentId}`, provider: "xreserve", mode: "receive",
    source: { kind: "spl", network: deployment.source.network, mint: deployment.source.mint, decimals: 6, symbol: "USDC", logo: "/asset-logos/usdc.svg" },
    destination: { kind: "miden", network: deployment.environment === "mainnet" ? "miden-mainnet" : "miden-testnet", faucetId: deployment.miden.faucetId,
      decimals: 6, symbol: "USDCx", logo: "/asset-logos/usdc.svg" }, recovery: currentBridgeConfig(deployment.environment),
    transport: "cctp-helper", execution: "automatic", helperDeployment: deployment, disabled: true };
}
function importSource(source: ManualSourceEvidence, deployment: HelperDeployment): Activity {
  const recipient = decodeArcRecipient(source.midenRecipient), attemptId = crypto.randomUUID();
  const authorization = { deploymentId: deployment.deploymentId, deployment, execution: "automatic" as const, sourceDomain: 5 as const, sourceAccount: source.sourceAccount,
    grossAmount: source.grossAmount, maxCctpFee: source.maxCctpFee, minimumNet: (BigInt(source.grossAmount) - BigInt(source.maxCctpFee)).toString(),
    midenRecipient: source.midenRecipient, finality: 2000 as const, checkedAt: new Date().toISOString() };
  const helper = helperActivitySchema.parse({ schemaVersion: 2, execution: "automatic", recoveryOnly: true, authorization, attemptId,
    stage: "source_finalized", eventAccount: source.eventAccount, scanStartSlot: source.slot, signature: source.sourceTransaction, sourceEvidence: source });
  validateSavedHelperSource(helper);
  return createActivity(recoveryRoute(deployment), formatUnits(BigInt(source.grossAmount), 6), { id: `act-${attemptId}`, cctpHelper: helper,
    solanaAddress: source.sourceAccount, midenAccount: recipient, midenAccountHex: recipient, destination: recipient, sourceTxHash: source.sourceTransaction,
    receivedAmount: formatUnits(BigInt(authorization.minimumNet), 6) });
}

/** Finalized successful source evidence is sufficient for read-only import, never for another burn. */
export async function recoverSolanaHelper(deploymentId: string, signature: string, history: readonly Activity[]): Promise<Activity> {
  const deployment = getHelperDeployment(deploymentId), source = await readRecoveredSource(deploymentId, signature);
  const identified = history.filter(activity => activity.cctpHelper?.signature === signature || matchesSavedSource(activity, source, deploymentId));
  if (identified.length > 1) throw new Error("Multiple saved attempts match. Preserve the evidence for review.");
  return identified[0] ? bindSavedSource(identified[0], source, deployment) : importSource(source, deployment);
}
