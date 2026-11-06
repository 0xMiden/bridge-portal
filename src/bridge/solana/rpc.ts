import { Connection, type ConnectionConfig } from "@solana/web3.js";
import { z } from "zod";
import type { HelperIdentity } from "../../config/cctp-helper";
import { solanaKey, solanaSignature } from "../../config/cctp-helper";

const index = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instruction = z.object({ programIdIndex: index, accounts: z.array(index).max(256), data: z.string().max(20_000), stackHeight: index.nullable().optional() });
const loaded = z.object({ writable: z.array(solanaKey).max(256), readonly: z.array(solanaKey).max(256) });
export const rawSolanaTransactionSchema = z.object({
  slot: index, version: z.union([z.literal("legacy"), z.literal(0), z.literal(1)]),
  transaction: z.object({ signatures: z.array(solanaSignature).min(1).max(32), message: z.object({
    accountKeys: z.array(solanaKey).min(1).max(256), recentBlockhash: solanaKey,
    header: z.object({ numRequiredSignatures: index, numReadonlySignedAccounts: index, numReadonlyUnsignedAccounts: index }),
    instructions: z.array(instruction).max(256), transactionConfig: z.unknown().optional(), addressTableLookups: z.unknown().optional(),
  }).passthrough() }),
  meta: z.object({ err: z.unknown(), innerInstructions: z.array(z.object({ index, instructions: z.array(instruction).max(1024) })).max(256).nullable(),
    loadedAddresses: loaded.optional(), }).passthrough(),
}).passthrough();
export type RawSolanaTransaction = z.infer<typeof rawSolanaTransactionSchema>;

function assertV1Transaction(tx: RawSolanaTransaction) {
  const message = tx.transaction.message;
  if (Object.hasOwn(message, "addressTableLookups")) throw new Error("Unexpected v1 address lookup tables.");
  const u32 = z.number().int().min(0).max(0xffffffff).nullable();
  z.object({ computeUnitLimit: u32, heapSize: u32, loadedAccountsDataSizeLimit: u32, priorityFee: index.nullable() }).strict().parse(message.transactionConfig);
  if (tx.meta.loadedAddresses?.writable.length || tx.meta.loadedAddresses?.readonly.length) throw new Error("Unexpected v1 loaded addresses.");
}

function assertTransactionVersion(tx: RawSolanaTransaction) {
  if (tx.version === 1) return assertV1Transaction(tx);
  const message = tx.transaction.message;
  if (Object.hasOwn(message, "transactionConfig")) throw new Error("Unexpected legacy/v0 transaction configuration.");
  if (tx.version !== "legacy") return;
  if (Object.hasOwn(message, "addressTableLookups")) throw new Error("Unexpected legacy address lookup tables.");
  if (tx.meta.loadedAddresses?.writable.length || tx.meta.loadedAddresses?.readonly.length) throw new Error("Unexpected legacy address lookup tables.");
}

function assertSourceHeader(tx: RawSolanaTransaction) {
  const message = tx.transaction.message, header = message.header;
  if (header.numRequiredSignatures !== tx.transaction.signatures.length || header.numRequiredSignatures > message.accountKeys.length ||
      header.numReadonlySignedAccounts > header.numRequiredSignatures) throw new Error("Invalid source account header.");
  if (header.numReadonlyUnsignedAccounts > message.accountKeys.length - header.numRequiredSignatures)
    throw new Error("Invalid source account header.");
}

function assertInstructionIndices(tx: RawSolanaTransaction, keyCount: number) {
  const message = tx.transaction.message;
  const parents = new Set<number>();
  for (const group of tx.meta.innerInstructions ?? []) {
    if (group.index >= message.instructions.length || parents.has(group.index)) throw new Error("Invalid inner-instruction parent.");
    parents.add(group.index);
  }
  for (const ix of [...message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap(group => group.instructions)]) {
    if (ix.programIdIndex >= keyCount || ix.accounts.some(account => account >= keyCount)) throw new Error("Invalid instruction account index.");
  }
}

export function guardSolanaTransaction(value: unknown, expectedSignature: string): RawSolanaTransaction {
  const tx = rawSolanaTransactionSchema.parse(value);
  if (tx.transaction.signatures[0] !== expectedSignature) throw new Error("Source transaction signature mismatch.");
  if (!Object.hasOwn(tx.meta, "err")) throw new Error("Missing source execution result.");
  assertTransactionVersion(tx);
  const keys = resolvedSolanaKeys(tx);
  assertSourceHeader(tx);
  assertInstructionIndices(tx, keys.length);
  return tx;
}

export function resolvedSolanaKeys(tx: RawSolanaTransaction) {
  if (tx.version !== 0) return tx.transaction.message.accountKeys;
  const tables = z.array(z.object({ accountKey: solanaKey, writableIndexes: z.array(index.max(255)), readonlyIndexes: z.array(index.max(255)) })).parse(tx.transaction.message.addressTableLookups);
  const addresses = tx.meta.loadedAddresses;
  if (!addresses || addresses.writable.length !== tables.reduce((sum, table) => sum + table.writableIndexes.length, 0) ||
      addresses.readonly.length !== tables.reduce((sum, table) => sum + table.readonlyIndexes.length, 0)) throw new Error("Incomplete v0 address lookup resolution.");
  return [...tx.transaction.message.accountKeys, ...addresses.writable, ...addresses.readonly];
}

async function readBoundedChunks(reader: ReadableStreamDefaultReader<Uint8Array>, maximum: number) {
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.length;
    if (length > maximum) throw new Error("Response too large.");
    chunks.push(part.value);
  }
  return { chunks, length };
}

export async function boundedText(response: Response, maximum = 4_000_000): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty upstream response.");
  let contents: Awaited<ReturnType<typeof readBoundedChunks>>;
  try { contents = await readBoundedChunks(reader, maximum); }
  finally { await reader.cancel(); }
  const { chunks, length } = contents;
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

/** The raw guard runs through the SDK's public fetch hook before any normalization. */
export function createSolanaConnection(deployment: HelperIdentity, endpoint?: string, observer?: (value: RawSolanaTransaction) => void, timeoutMs = 12_000) {
  const url = endpoint ?? new URL(`/api/cctp-helper/manual/rpc?deploymentId=${encodeURIComponent(deployment.deploymentId)}`, window.location.origin).href;
  const guardedFetch: NonNullable<ConnectionConfig["fetch"]> = async (input, init) => {
    const request = z.object({ method: z.string(), params: z.array(z.unknown()).optional() }).parse(JSON.parse(String(init?.body)));
    const response = await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error("Solana transport unavailable.");
    const raw = await boundedText(response);
    if (request.method === "getTransaction") {
      const envelope = z.object({ result: z.unknown().optional(), error: z.unknown().optional() }).parse(JSON.parse(raw));
      if (envelope.result !== null && envelope.result !== undefined)
        observer?.(guardSolanaTransaction(envelope.result, solanaSignature.parse(request.params?.[0])));
      // Always guard, including callers that do not need a raw source projection.
      if (!observer && envelope.result !== null && envelope.result !== undefined)
        guardSolanaTransaction(envelope.result, solanaSignature.parse(request.params?.[0]));
    }
    return new Response(raw, { status: response.status, headers: { "content-type": "application/json" } });
  };
  return new Connection(url, { commitment: "confirmed", fetch: guardedFetch, disableRetryOnRateLimit: true });
}

export async function assertSolanaGenesis(connection: Connection, deployment: HelperIdentity) {
  if (await connection.getGenesisHash() !== deployment.source.genesisHash) throw new Error("The Solana RPC is on the wrong cluster.");
}
