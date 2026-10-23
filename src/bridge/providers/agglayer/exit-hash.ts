import { keccak256, stringToHex } from "viem";

/** Gateway's bridge-out/v1 identifier commits to the note details, not its ID or wallet transaction. */
export function agglayerExitHash(detailsCommitment: string): string {
  if (!/^(?:0x)?[\da-f]{64}$/i.test(detailsCommitment)) throw new Error("Invalid withdrawal note commitment.");
  return keccak256(stringToHex(`miden-agglayer/bridge-out/v1\0${detailsCommitment.replace(/^0x/i, "").toLowerCase()}`));
}
