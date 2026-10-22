import { Buffer } from "node:buffer";
import { z } from "zod";
import { deploymentMiden } from "../../../config/deployments";
import { normalizeMidenAccountHex } from "./agglayer";
import { agglayerExitHash } from "./exit-hash";

// Only the locator comes from Midenscan. The exact transaction ID, account and
// output commitments must agree with the configured Miden node's transaction header.
const locatorSchema = z.object({
  data: z.object({ transaction: z.object({
    transaction_id: z.string(), account_bech: z.string(),
    block_number: z.string().regex(/^\d+$/),
  }).nullable() }).nullable(),
  errors: z.array(z.unknown()).optional(),
});

const explorerApis = {
  "miden-mainnet": "https://scan-backend-cedar-miden.eu-central-8.gateway.fm/graphql",
  "miden-testnet": "https://scan-backend-testnet-miden.eu-central-8.gateway.fm/graphql",
} as const;

// Minimal read-only wire surface from miden-node-proto 0.17.3 rpc.proto and
// miden-objects 0.17.1 transaction/note/account/primitives.proto. This avoids
// loading the native Node SDK or browser WASM in the Cloudflare Worker.
function readVarint(bytes: Buffer, cursor: { offset: number }) {
  let value = 0;
  for (let shift = 0; shift < 35; shift += 7) {
    if (cursor.offset >= bytes.length) throw new Error("Truncated Miden RPC response.");
    const byte = bytes[cursor.offset++];
    value += (byte & 127) * 2 ** shift;
    if (!(byte & 128)) return value;
  }
  throw new Error("Invalid Miden RPC integer.");
}

function wireLength(wire: number, varint: () => number) {
  if (wire === 2) return varint();
  if (wire === 1) return 8;
  if (wire === 5) return 4;
  return -1;
}

function fields(bytes: Buffer): Map<number, Buffer[]> {
  const result = new Map<number, Buffer[]>();
  const cursor = { offset: 0 };
  const varint = () => readVarint(bytes, cursor);
  while (cursor.offset < bytes.length) {
    const tag = varint();
    const wire = tag % 8;
    if (!Math.floor(tag / 8)) throw new Error("Invalid Miden RPC field.");
    if (wire === 0) { varint(); continue; }
    const length = wireLength(wire, varint);
    if (length < 0 || cursor.offset + length > bytes.length) throw new Error("Invalid Miden RPC response.");
    const number = Math.floor(tag / 8);
    result.set(number, [...(result.get(number) ?? []), bytes.subarray(cursor.offset, cursor.offset + length)]);
    cursor.offset += length;
  }
  return result;
}

function requiredField(bytes: Buffer, number: number): Buffer {
  const values = fields(bytes).get(number);
  if (values?.length !== 1) throw new Error("Missing or ambiguous Miden RPC field.");
  return values[0];
}

function word(bytes: Buffer): string {
  const encoded = requiredField(bytes, 1);
  if (encoded.length !== 32) throw new Error("Invalid Miden commitment.");
  return `0x${encoded.toString("hex")}`;
}

function message(number: number, value: Buffer): Buffer {
  // All request submessages here are smaller than 128 bytes.
  return Buffer.concat([Buffer.from([number * 8 + 2, value.length]), value]);
}

function fixed(number: number, value: bigint, size: 4 | 8): Buffer {
  const buffer = Buffer.alloc(size + 1);
  buffer[0] = number * 8 + (size === 4 ? 5 : 1);
  if (size === 4) buffer.writeUInt32LE(Number(value), 1);
  else buffer.writeBigUInt64LE(value, 1);
  return buffer;
}

function accountMessage(hex: string): Buffer {
  return message(1, Buffer.concat([
    message(1, fixed(1, BigInt(`0x${hex.slice(16)}00`), 8)),
    message(2, fixed(1, BigInt(`0x${hex.slice(0, 16)}`), 8)),
  ]));
}

function grpcPayload(bytes: Buffer, headerStatus: string | null): Buffer {
  const payloads: Buffer[] = [];
  let status = headerStatus;
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 5 > bytes.length) throw new Error("Truncated Miden RPC frame.");
    const flag = bytes[offset];
    const length = bytes.readUInt32BE(offset + 1);
    offset += 5;
    if (offset + length > bytes.length) throw new Error("Truncated Miden RPC payload.");
    const payload = bytes.subarray(offset, offset + length);
    if (flag === 0) payloads.push(payload);
    else if (flag === 128) status = /^grpc-status:\s*(\d+)\s*$/mi.exec(payload.toString())?.[1] ?? null;
    else throw new Error("Unsupported Miden RPC frame.");
    offset += length;
  }
  if (status !== "0" || payloads.length !== 1) throw new Error("Miden transaction lookup failed.");
  return payloads[0];
}

async function locateWithdrawal(hash: string, network: ReturnType<typeof deploymentMiden>, signal: AbortSignal) {
  const response = await fetch(explorerApis[network.network], {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal,
    body: JSON.stringify({
      query: "query($input: TransactionInput!) { transaction(input: $input) { transaction_id account_bech block_number } }",
      variables: { input: { transaction_id: hash } },
    }),
  });
  if (!response.ok) throw new Error("Miden transaction lookup is unavailable.");
  const located = locatorSchema.parse(await response.json());
  if (located.errors?.length) throw new Error("Miden transaction has not been indexed yet.");
  const transaction = located.data?.transaction;
  if (!transaction) return undefined;
  if (transaction.transaction_id.toLowerCase() !== hash.toLowerCase()) throw new Error("Miden transaction mismatch.");
  const block = Number(transaction.block_number);
  if (!Number.isSafeInteger(block) || block < 0 || block > 0xffffffff) throw new Error("Invalid Miden block.");
  const account = accountMessage(normalizeMidenAccountHex(transaction.account_bech));
  return { block, account };
}

export async function recoverWithdrawalExitHashes(hash: string, deploymentId: string | undefined, signal: AbortSignal): Promise<string[]> {
  const network = deploymentMiden(deploymentId);
  const located = await locateWithdrawal(hash, network, signal);
  if (!located) return [];
  const { block, account } = located;
  const body = Buffer.concat([
    message(1, Buffer.concat([fixed(1, BigInt(block), 4), fixed(2, BigInt(block), 4)])),
    message(2, account),
  ]);
  const frame = Buffer.alloc(5);
  frame.writeUInt32BE(body.length, 1);
  const rpc = await fetch(`${network.rpcUrl.replace(/\/$/, "")}/miden.node.v1.NodeService/SyncTransactions`, {
    method: "POST", headers: { "content-type": "application/grpc-web+proto", "x-grpc-web": "1" },
    body: Buffer.concat([frame, body]), cache: "no-store", signal,
  });
  if (!rpc.ok) throw new Error("Miden transaction lookup is unavailable.");
  const payload = grpcPayload(Buffer.from(await rpc.arrayBuffer()), rpc.headers.get("grpc-status"));
  return verifiedExitHashes(payload, hash, block, account);
}

function verifiedExitHashes(payload: Buffer, hash: string, block: number, account: Buffer) {
  for (const record of fields(payload).get(2) ?? []) {
    const header = requiredField(record, 2);
    if (word(requiredField(requiredField(header, 1), 1)).toLowerCase() !== hash.toLowerCase()) continue;
    const height = requiredField(record, 1);
    if (height.length !== 4 || height.readUInt32LE() !== block || !requiredField(header, 2).equals(account))
      throw new Error("Miden transaction inclusion mismatch.");
    return (fields(header).get(6) ?? []).map(note => agglayerExitHash(word(requiredField(note, 2))));
  }
  return [];
}
