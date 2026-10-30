import { parseAbi } from "viem";
export const helperAbi = parseAbi([
  "function messageTransmitter() view returns (address)", "function tokenMessenger() view returns (address)",
  "function usdc() view returns (address)", "function xReserve() view returns (address)",
  "function midenDomain() view returns (uint32)", "function expectedMidenFaucet() view returns (bytes32)",
  "function receiveAndDeposit(bytes message,bytes attestation)",
]);
