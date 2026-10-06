import { Word } from "@miden-sdk/miden-sdk";

/** Fresh fee-conversion salt for custom requests, also used as a multisig replay guard. */
export function createFeeConversionSalt(): Word {
  const felts = new BigUint64Array(4);
  for (let i = 0; i < felts.length; i++) {
    // Word requires canonical Goldilocks field elements. Reject the tiny
    // out-of-field range instead of rounding or reducing random values.
    do {
      crypto.getRandomValues(felts.subarray(i, i + 1));
    } while (felts[i] >= 18_446_744_069_414_584_321n);
  }
  return new Word(felts);
}
