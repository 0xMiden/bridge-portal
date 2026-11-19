import { base58check, bech32, bech32m } from "@scure/base";
import { sha256 } from "@noble/hashes/sha256";
import { z } from "zod";

/** Mainnet P2PKH, P2SH, SegWit v0 and Taproot, including checksum and program length. */
export function isBitcoinAddress(value: string): boolean {
  if (value.length > 90) return false;
  try {
    if (/^bc1/i.test(value)) {
      const codec = /^bc1p/i.test(value) ? bech32m : bech32;
      const { prefix, words } = codec.decode(value as `${string}1${string}`);
      const program = codec.fromWords(words.slice(1));
      return prefix === "bc" && (
        (words[0] === 0 && (program.length === 20 || program.length === 32)) ||
        (words[0] === 1 && program.length === 32)
      );
    }
    const payload = base58check(sha256).decode(value);
    return payload.length === 21 && (payload[0] === 0 || payload[0] === 5);
  } catch { return false; }
}

export const bitcoinAddressSchema = z.string().max(90).refine(isBitcoinAddress, "Enter a valid Bitcoin mainnet address");
export const bitcoinTxHashSchema = z.string().regex(/^[\da-f]{64}$/i);
