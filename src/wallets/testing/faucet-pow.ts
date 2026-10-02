// Proof-of-work for https://faucet.testnet.miden.io. The challenge body is the
// 120-byte serialization from GET /pow. A nonce solves it when
// SHA-256(challenge || nonce_be_u64), read as a big-endian u64 from the first
// 8 bytes, is strictly below `target`.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256 of `message`. Sync so the nonce search does not yield every hash. */
export function sha256(message: Uint8Array): Uint8Array {
  const bitLen = message.length * 8;
  const withOne = message.length + 1;
  const padLen = (withOne % 64 <= 56 ? 56 - (withOne % 64) : 56 + 64 - (withOne % 64));
  const data = new Uint8Array(message.length + 1 + padLen + 8);
  data.set(message);
  data[message.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 4, bitLen, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((word, i) => outView.setUint32(i * 4, word, false));
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("hex length must be even");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error("hex is not valid");
    out[i] = byte;
  }
  return out;
}

/** 32-byte account init seed. Rejects anything else so newWallet cannot drift. */
export function parseAccountSeed(hex: string): Uint8Array {
  const bytes = hexToBytes(hex.trim());
  if (bytes.length !== 32) {
    throw new Error(`E2E_MIDEN_SEED must be 32 bytes (64 hex chars), got ${bytes.length}`);
  }
  return bytes;
}

const CHALLENGE_BYTES = 120;

/**
 * Smallest nonce whose SHA-256(challenge || nonce) is below `target`.
 * `maxNonce` bounds a hostile or overloaded faucet so the page cannot spin forever.
 */
/** One whole token in base units. Unknown decimals fall back to the testnet faucet's 6. */
export function faucetMintAmount(decimals: number | undefined): number {
  const places =
    Number.isInteger(decimals) && (decimals as number) >= 0 && (decimals as number) <= 8
      ? (decimals as number)
      : 6;
  return 10 ** places;
}

export function solveFaucetPow(challengeHex: string, target: number | bigint, maxNonce = 5_000_000): number {
  const challenge = hexToBytes(challengeHex);
  if (challenge.length !== CHALLENGE_BYTES) {
    throw new Error(`faucet challenge is ${challenge.length} bytes, expected ${CHALLENGE_BYTES}`);
  }
  const limit = BigInt(target);
  const block = new Uint8Array(CHALLENGE_BYTES + 8);
  block.set(challenge);
  const view = new DataView(block.buffer);
  for (let nonce = 0; nonce < maxNonce; nonce += 1) {
    view.setUint32(CHALLENGE_BYTES, Math.floor(nonce / 0x100000000), false);
    view.setUint32(CHALLENGE_BYTES + 4, nonce >>> 0, false);
    const hash = sha256(block);
    const head = new DataView(hash.buffer, hash.byteOffset, 8).getBigUint64(0, false);
    if (head < limit) return nonce;
  }
  throw new Error(`faucet proof-of-work was not solved in ${maxNonce} attempts`);
}
