import { pad, parseUnits, type Hex } from "viem";
import { normalizeMidenAccountHex } from "../../miden-address";
import { ARC_MAX_MIDEN_AMOUNT } from "./config";

export function parseArcAmount(amount: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount.trim())) {
    throw new Error("Enter a USDC amount with at most 6 decimal places.");
  }
  const value = parseUnits(amount.trim(), 6);
  if (value <= 0n || value > ARC_MAX_MIDEN_AMOUNT)
    throw new Error("USDC amount is outside the supported range.");
  return value;
}

export function arcRecipient(address: string): Hex {
  // EthEmbeddedAccountId: append the suffix padding byte, THEN left-pad.
  return pad(`0x${normalizeMidenAccountHex(address)}00`, { size: 32 });
}
