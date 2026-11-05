import { parseAbi } from "viem";
export const helperAbi = parseAbi([
  "function messageTransmitter() view returns (address)", "function tokenMessenger() view returns (address)",
  "function usdc() view returns (address)", "function xReserve() view returns (address)",
  "function midenDomain() view returns (uint32)", "function expectedMidenFaucet() view returns (bytes32)",
  "function receiveAndDeposit(bytes message,bytes attestation)",
  "event DepositedToMiden(uint32 indexed sourceDomain,bytes32 indexed cctpNonce,bytes32 indexed midenRecipient,uint256 amount)",
]);
export const helperMessageAbi = parseAbi([
  "event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)",
]);
