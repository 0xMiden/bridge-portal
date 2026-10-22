import { z } from "zod";
import type { Hex } from "viem";
import { hexDataSchema } from "../../evm/evm-schema";
import { parseArcDepositIntent, type ArcDepositIntent } from "./attestation";
import { arcConfig } from "./config";
import { CircleApiError } from "./circle-error";
import { getCircleJson, reportCircleFailure } from "./circle-http.server";
import { parseCirclePayload } from "./circle-schema";

const domainSchema = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.int().min(0).max(0xffffffff));
const attestationsSchema = z.object({
  attestations: z.array(z.object({
    remoteDomain: domainSchema,
    attestation: hexDataSchema.refine(value => value.length > 2).nullish(),
    payload: hexDataSchema.nullish(),
  })),
});
type Attestation = z.infer<typeof attestationsSchema>["attestations"][number];
type Deposit = Omit<ArcDepositIntent, "nonce">;
type AttestationResult = { intent?: ArcDepositIntent; warning?: string };

function readMatchingIntent(attestation: Attestation, deposit: Deposit, deploymentId?: string): ArcDepositIntent {
  let intent: ArcDepositIntent;
  try {
    if (!attestation.payload) throw new Error("Missing deposit payload.");
    intent = parseArcDepositIntent(attestation.payload, deploymentId);
  } catch (cause) {
    throw new CircleApiError("invalid_response", "Circle returned an unsupported deposit payload.", { cause });
  }
  if (intent.amount !== deposit.amount || intent.recipient !== deposit.recipient) {
    throw new CircleApiError("binding_mismatch", "Circle returned a different deposit amount or recipient.");
  }
  if (intent.faucet !== deposit.faucet || intent.sender !== deposit.sender) {
    throw new CircleApiError("binding_mismatch", "Circle returned a different deposit faucet or sender.");
  }
  return intent;
}

function findDepositAttestation(attestations: Attestation[], deposit: Deposit, deploymentId?: string): AttestationResult {
  const arc = arcConfig(deploymentId);
  let unreadable = false;
  for (const attestation of attestations) {
    if (attestation.remoteDomain !== arc.midenDomain || !attestation.attestation) continue;
    try {
      return { intent: readMatchingIntent(attestation, deposit, deploymentId) };
    } catch (error) {
      reportCircleFailure("status", error);
      unreadable = true;
    }
  }
  return unreadable ? { warning: "Circle returned details that do not match this deposit. Tracking will retry." } : {};
}

export async function getArcDepositAttestation(hash: Hex, deposit: Deposit, deploymentId?: string): Promise<AttestationResult> {
  const arc = arcConfig(deploymentId);
  try {
    const body = await getCircleJson(`${arc.attestationApi}/v1/attestations?txHash=${hash}`);
    if (body === undefined) return {};
    const { attestations } = parseCirclePayload(attestationsSchema, body, "Circle returned invalid deposit attestations.");
    return findDepositAttestation(attestations, deposit, deploymentId);
  } catch (error) {
    reportCircleFailure("status", error);
    return { warning: "Circle status unavailable. Tracking will retry." };
  }
}
