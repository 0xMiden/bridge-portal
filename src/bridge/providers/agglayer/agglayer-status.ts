import type { BridgeConfig } from "../../../config/bridge-config";
import { agglayerConfig } from "./agglayer";
import { depositPageSchema, type AgglayerDeposit } from "./status-schema";

type Lookup = { destination: string; recovery?: BridgeConfig; signal?: AbortSignal };
const pageSize = 100;

function isLastPage(page: ReturnType<typeof depositPageSchema.parse>, offset: number) {
  if (!page.deposits.length) return true;
  if (page.total_cnt !== undefined) return BigInt(offset) >= BigInt(page.total_cnt);
  return page.deposits.length < pageSize;
}

async function* depositPages({ destination, recovery, signal }: Lookup) {
  const config = agglayerConfig(recovery);
  const timeout = AbortSignal.timeout(15_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let offset = 0;
  // Bound work even if an upstream repeats pages or reports an invalid total.
  for (let index = 0; index < 100; index += 1) {
    const url = `${config.bridgeServiceApi}/bridges/${encodeURIComponent(destination)}?limit=${pageSize}&offset=${offset}`;
    const response = await fetch(url, { cache: "no-store", redirect: "manual", signal: requestSignal });
    if (!response.ok) throw new Error(`Agglayer bridge status ${response.status}`);
    const page = depositPageSchema.parse(await response.json());
    yield page.deposits;
    offset += page.deposits.length;
    if (isLastPage(page, offset)) return;
  }
  throw new Error("Agglayer deposit lookup exceeded its page limit. Tracking will retry.");
}

/** Source transaction identity prevents newer deposits from hiding an older receive. */
export async function readDepositStatus(lookup: Lookup, sourceTxHash?: string) {
  let latestDeposit: AgglayerDeposit | null = null;
  for await (const page of depositPages(lookup)) {
    latestDeposit ??= page[0] ?? null;
    const deposits = sourceTxHash
      ? page.filter(deposit => deposit.tx_hash?.toLowerCase() === sourceTxHash.toLowerCase())
      : page;
    if (!sourceTxHash || deposits.length) return { destinationAddress: lookup.destination, deposits, latestDeposit };
  }
  return { destinationAddress: lookup.destination, deposits: [], latestDeposit };
}

function matchesWithdrawal(deposit: AgglayerDeposit, lookup: Lookup, expected: Set<string>) {
  const config = agglayerConfig(lookup.recovery);
  const correctRoute = deposit.network_id === config.midenIndexerNetworkId && deposit.dest_net === config.sourceNetworkId;
  const correctIdentity = deposit.dest_addr?.toLowerCase() === lookup.destination.toLowerCase() &&
    expected.has(deposit.tx_hash?.toLowerCase() ?? "");
  return correctRoute && correctIdentity;
}

// Only output-note commitments bind an exit; recipient, amount and deposit count cannot.
export async function findMidenToEvmDeposit(
  l1Dest: string, exitHashes: readonly string[], signal?: AbortSignal, recovery?: BridgeConfig,
): Promise<AgglayerDeposit | null> {
  if (!exitHashes.length || exitHashes.some(hash => !/^0x[\da-f]{64}$/i.test(hash))) return null;
  const lookup = { destination: l1Dest, recovery, signal };
  const expected = new Set(exitHashes.map(hash => hash.toLowerCase()));
  for await (const page of depositPages(lookup)) {
    const matching = page.filter(deposit => matchesWithdrawal(deposit, lookup, expected));
    if (matching.length > 1) throw new Error("Multiple exits match this withdrawal. Tracking needs verification.");
    if (matching.length === 1) return matching[0];
  }
  return null;
}
