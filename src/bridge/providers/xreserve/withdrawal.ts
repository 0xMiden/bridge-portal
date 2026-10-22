import { hexToBytes, isAddress, padHex } from "viem";
import type { BridgeNetwork } from "../../core/assets";
import { parseArcAmount } from "./deposit-terms";
import { CircleApiError } from "./circle-error";

export const withdrawalDomains: Partial<Record<BridgeNetwork, number>> = {
  "arc-testnet": 26, sepolia: 0, "base-sepolia": 6, "arbitrum-sepolia": 3,
  arc: 26, ethereum: 0, base: 6, arbitrum: 3,
};

export function withdrawalDomain(network: BridgeNetwork): number {
  const domain = withdrawalDomains[network];
  if (domain === undefined) throw new Error("Unsupported withdrawal network.");
  return domain;
}

/** Protocol v0.17.1 XReserveBurnItems: domain word + eight LE u32 recipient limbs. */
export function withdrawalPayload(destination: string, domain: number): bigint[] {
  if (!isAddress(destination) || /^0x0{40}$/i.test(destination)) {
    throw new Error("Enter a valid address on a supported withdrawal network.");
  }
  if (!Number.isInteger(domain) || !Object.values(withdrawalDomains).includes(domain)) {
    throw new Error("Enter a valid address on a supported withdrawal network.");
  }
  const bytes = hexToBytes(padHex(destination, { size: 32 }));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [BigInt(domain), 0n, 0n, 0n, ...Array.from({ length: 8 }, (_, i) => BigInt(view.getUint32(i * 4, true)))];
}

export function validateWithdrawal(amount: string, network: BridgeNetwork): bigint {
  withdrawalDomain(network);
  const value = parseArcAmount(amount);
  if (value < 1_000_000n) throw new Error("Withdraw at least 1 USDCx. The faucet may require a higher minimum.");
  // Bread's testnet allowance; an estimate, not a guaranteed fee ceiling.
  if (network === "sepolia" && value <= 1_500_000n) throw new Error("Send more than 1.5 USDCx to Sepolia to allow for Circle's payout fee.");
  return value;
}

/** Withdrawal fees are deducted from the payout, never added to the burned amount. */
export function assertWithdrawalAmounts(amount: bigint, fee: string, received: string): void {
  const payout = BigInt(received);
  if (payout <= 0n || payout + BigInt(fee) !== amount) {
    throw new CircleApiError("binding_mismatch", "Circle's withdrawal quote does not match the amount.");
  }
}
