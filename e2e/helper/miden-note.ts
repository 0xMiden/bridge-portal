import { Buffer } from "node:buffer";

const varint = (value: number) => {
  const bytes: number[] = [];
  do { bytes.push((value & 127) | (value > 127 ? 128 : 0)); value >>>= 7; } while (value);
  return Buffer.from(bytes);
};
const message = (field: number, bytes: Uint8Array) => Buffer.concat([varint(field * 8 + 2), varint(bytes.length), bytes]);
const fixed = (field: number, value: bigint, width: 4 | 8) => {
  const out = Buffer.alloc(width + 1); out[0] = field * 8 + (width === 4 ? 5 : 1);
  if (width === 4) out.writeUInt32LE(Number(value), 1); else out.writeBigUInt64LE(value, 1);
  return out;
};
const scalar = (field: number, value: number) => Buffer.concat([varint(field * 8), varint(value)]);
function grpcFrame(payload: Buffer) {
  const frame = Buffer.alloc(5); frame.writeUInt32BE(payload.length, 1);
  const trailer = Buffer.from("grpc-status: 0\r\n");
  const trailerHeader = Buffer.alloc(5); trailerHeader[0] = 128; trailerHeader.writeUInt32BE(trailer.length, 1);
  return Buffer.concat([frame, payload, trailerHeader, trailer]);
}
export function midenLimitsResponse() {
  const limits = [["GetNotesById", "note_id"], ["SyncNullifiers", "nullifier_prefix"], ["SyncTransactions", "account_id"], ["SyncNotes", "note_tag"]];
  return grpcFrame(Buffer.concat(limits.map(([endpoint, parameter]) => message(1, Buffer.concat([
    message(1, Buffer.from(endpoint)), message(2, message(1, Buffer.concat([message(1, Buffer.from(parameter)), scalar(2, 100)]))),
  ])))));
}

/** miden-node-proto0.17.3 / miden-objects0.17.1 synthetic exact-note inclusion response.
 * Content is hidden in this fixture; the production reader trusts the configured RPC's proof/ID.
 */
export function midenNoteResponse(noteId: string, faucet: string, block = 42) {
  const id = message(1, message(1, Buffer.from(noteId.slice(2), "hex")));
  const account = message(1, Buffer.concat([message(1, fixed(1, BigInt(`0x${faucet.slice(18)}00`), 8)),
    message(2, fixed(1, BigInt(`0x${faucet.slice(2, 18)}`), 8))]));
  const metadata = Buffer.concat([scalar(1, 1), message(2, account), scalar(3, 1), fixed(4, 0n, 4)]);
  const note = Buffer.concat([message(1, metadata), message(3, Buffer.alloc(0))]);
  const proof = Buffer.concat([message(1, id), message(2, fixed(1, BigInt(block), 4)), message(4, Buffer.alloc(0))]);
  const payload = message(1, Buffer.concat([message(1, note), message(2, proof)]));
  return grpcFrame(payload);
}

export function requestedMidenNote(body: Buffer): string {
  if (body.length !== 43 || body.subarray(5, 11).toString("hex") !== "0a240a220a20") throw new Error("Unexpected exact-note RPC request.");
  return `0x${body.subarray(11).toString("hex")}`;
}
