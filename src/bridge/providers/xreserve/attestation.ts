import { ARC, ARC_MAX_MIDEN_AMOUNT } from "./config";

export type ArcDepositIntent = {
  amount: string;
  recipient: string;
  faucet: string;
  sender: string;
  nonce: string;
};

export function decodeArcRecipient(value: string): string {
  if (!/^0x0{32}[\da-f]{30}00$/i.test(value))
    throw new Error("Invalid Miden account encoding.");
  return `0x${value.slice(34, 64).toLowerCase()}`;
}

/** Circle DepositIntent v1; offsets match miden-usdcx's deposit_intent codec. */
export function parseArcDepositIntent(payload: string): ArcDepositIntent {
  if (!/^0x(?:[\da-f]{2})+$/i.test(payload))
    throw new Error("Invalid Circle payload.");
  const hex = payload.slice(2).toLowerCase();
  const field = (offset: number, size: number) =>
    hex.slice(offset * 2, (offset + size) * 2);
  if (
    hex.length < 480 ||
    field(0, 4) !== "5a2e0acd" ||
    field(4, 4) !== "00000001" ||
    Number.parseInt(field(40, 4), 16) !== ARC.midenDomain ||
    hex.length !== (240 + Number.parseInt(field(236, 4), 16)) * 2 ||
    field(172, 32) !== "0".repeat(64) ||
    field(236, 4) !== "00000000" ||
    field(108, 32) !== ARC.usdc.slice(2).toLowerCase().padStart(64, "0")
  ) {
    throw new Error("Unsupported Circle deposit payload.");
  }
  const account = (offset: number) => {
    return decodeArcRecipient(`0x${field(offset, 32)}`);
  };
  const amount = BigInt(`0x${field(8, 32)}`);
  if (
    amount <= 0n ||
    amount > ARC_MAX_MIDEN_AMOUNT ||
    !/^0{24}/.test(field(140, 32))
  ) {
    throw new Error("Invalid Circle deposit amount or sender.");
  }
  return {
    amount: amount.toString(),
    recipient: account(76),
    faucet: account(44),
    sender: `0x${field(152, 20)}`,
    nonce: `0x${field(204, 32)}`,
  };
}
