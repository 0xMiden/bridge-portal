import type { HelperDeployment } from "../../../config/cctp-helper";

const attempts = new Set<string>(), intents = new Set<string>();
const lockName = "miden.bridge.cctp-helper.source";

export function manualIntentKey(deployment: HelperDeployment, sourceAccount: string, grossAmount: string, midenRecipient: string) {
  return JSON.stringify([deployment.deploymentId, deployment.source.genesisHash, deployment.source.mint,
    deployment.arc.chainId, deployment.helper.address.toLowerCase(), sourceAccount, grossAmount, midenRecipient.toLowerCase()]);
}

/** Reserve synchronously, before a loader, quote, storage read or transaction preparation can yield. */
export function reserveManualSubmission(attemptId: string, intent: string) {
  if (attempts.has(attemptId) || intents.has(intent)) throw new Error("This source attempt is already in progress. Do not burn again.");
  attempts.add(attemptId); intents.add(intent);
  return () => { attempts.delete(attemptId); intents.delete(intent); };
}

/** The browser releases this lock on tab termination. A durable review always precedes signing. */
export async function withManualSourceLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request)
    throw new Error("Safe manual submission requires Web Locks on a secure origin. This browser cannot submit the source transaction.");
  return navigator.locks.request(lockName, { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Another tab is handling a source attempt. Recover that attempt before trying again.");
    return operation();
  });
}
