import { getEnvironmentConfig } from "../config/environments";

// AggLayer / Gateway-FM deposit indexer reads — lets e2e specs assert the bridge
// actually observed a deposit for a destination, independent of the app's own
// polling.

export interface AgglayerDeposit {
  tx_hash?: string;
  deposit_cnt?: number | string;
  ready_for_claim?: boolean;
  network_id?: number;
  dest_net?: number;
}

/** Fetch deposits the bridge has observed for a destination address. */
export async function fetchAgglayerDeposits(
  destinationAddress: string,
): Promise<AgglayerDeposit[]> {
  const env = getEnvironmentConfig();
  const url = `${env.agglayerBridgeApi}/bridges/${destinationAddress}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return [];
  const body = (await res.json()) as { deposits?: AgglayerDeposit[] };
  return body.deposits ?? [];
}

/** Poll until the bridge reports a deposit for the destination (or times out). */
export async function waitForAgglayerDeposit(
  destinationAddress: string,
  { timeoutMs = 900_000, intervalMs = 15_000 } = {},
): Promise<AgglayerDeposit | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const deposits = await fetchAgglayerDeposits(destinationAddress).catch(
      () => [],
    );
    if (deposits.length > 0) return deposits[0];
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}
