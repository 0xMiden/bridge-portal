import { hexToBytes, isAddress, padHex } from "viem";
import type { BridgeNetwork } from "../../core/assets";
import { parseArcAmount } from "./deposit";

export const withdrawalDomains: Partial<Record<BridgeNetwork, number>> = {
  "arc-testnet": 26, sepolia: 0, "base-sepolia": 6, "arbitrum-sepolia": 3,
  arc: 26, ethereum: 0, base: 6, arbitrum: 3,
};

/** Protocol v0.17.1 XReserveBurnItems: domain word + eight LE u32 recipient limbs. */
export function withdrawalPayload(destination: string, domain: number): bigint[] {
  if (!isAddress(destination) || /^0x0{40}$/i.test(destination) ||
      !Number.isInteger(domain) || !Object.values(withdrawalDomains).includes(domain)) {
    throw new Error("Enter a valid address on a supported withdrawal network.");
  }
  const bytes = hexToBytes(padHex(destination, { size: 32 }));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [BigInt(domain), 0n, 0n, 0n, ...Array.from({ length: 8 }, (_, i) => BigInt(view.getUint32(i * 4, true)))];
}

export function validateWithdrawal(amount: string, network: BridgeNetwork): bigint {
  if (withdrawalDomains[network] === undefined) throw new Error("Unsupported withdrawal network.");
  const value = parseArcAmount(amount);
  if (value < 1_000_000n) throw new Error("Withdraw at least 1 USDCx. The faucet may require a higher minimum.");
  // Bread's testnet allowance; an estimate, not a guaranteed fee ceiling.
  if (network === "sepolia" && value <= 1_500_000n) throw new Error("Send more than 1.5 USDCx to Sepolia to allow for Circle's payout fee.");
  return value;
}
