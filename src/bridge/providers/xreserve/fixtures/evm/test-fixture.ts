import { currentBridgeConfig } from "../../../../../config/bridge-config";
import { encodeAbiParameters, encodeEventTopics, encodePacked, keccak256, pad, parseAbi } from "viem";
import old from "../manual/deployment.json";
import golden from "../manual/solana-golden.json";
import { evmHelperDeploymentSchema } from "../../../../../config/cctp-evm-helper";
import { evmHelperCallData, evmHelperIntent } from "../../helper-evm-call";
import type { EvmManualAuthorization, EvmHelperActivity } from "../../helper-evm-types";
export const sender = "0x1111111111111111111111111111111111111111" as const;
export const txHash = `0x${"ab".repeat(32)}` as const;
export const blockHash = `0x${"bc".repeat(32)}` as const;
export const code = "0x6000";
const contract = (address: string) => ({ address, runtimeHash: keccak256(code) });
export const evmDeployment = evmHelperDeploymentSchema.parse({ ...old[0], deploymentId: "evm-sepolia-test", source: {
  runtime: "evm", network: "sepolia", chainId: 11155111, domain: 0,
  usdc: contract("0x1c7d4b196cb0c7b01d743fbc6116a902379c7238"), tokenMessenger: { ...contract("0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa"), implementation: contract("0x2222222222222222222222222222222222222222") },
  messageTransmitter: contract("0xe737e5cebeeba77efe34d4aa090756590b1ce275"), tokenMinter: contract("0xb43db544e2c27092c107639ad201b3defabcf192"),
  startBlock: "1", finality: "finalized", feePolicy: "legacy-zero-standard",
}, qualification: { evidenceHash: `0x${"12".repeat(32)}`, helperAsDepositor: true, zeroRemoteFee: true, arcRuntime: true,
  sourceRuntime: true, sourceFeePolicy: true, finalizedRpc: true, walletSend: true } });
export function evmAuthorization(): EvmManualAuthorization {
  return { runtime: "evm", execution: "manual", deploymentId: evmDeployment.deploymentId, deployment: evmDeployment,
    sourceAccount: sender, grossAmount: "1000000", maxCctpFee: "100", minimumNet: "999900", midenRecipient: golden.miden.bytes32 as `0x${string}`,
    checkedAt: new Date().toISOString(), finality: 2000 };
}
export function evmRow(): EvmHelperActivity {
  const authorization = evmAuthorization();
  return { schemaVersion: 1, runtime: "evm", authorization, attemptId: crypto.randomUUID(), intent: evmHelperIntent(authorization),
    recovery: currentBridgeConfig("testnet"), stage: "source_unknown", startBlock: "100", requestedNonce: 3, callData: evmHelperCallData(authorization), hash: txHash, hashOrigin: "wallet" };
}
export function evmMessage(auth = evmAuthorization()) {
  const d = auth.deployment, s = d.source;
  return encodePacked(["uint32", "uint32", "uint32", "bytes32", "bytes32", "bytes32", "bytes32", "uint32", "uint32",
    "uint32", "bytes32", "bytes32", "uint256", "bytes32", "uint256", "uint256", "uint256", "bytes"],
  [1, s.domain, 26, pad("0x00"), pad(s.tokenMessenger.address), pad(d.arc.tokenMessenger.address), pad(d.helper.address), 2000, 0,
    1, pad(s.usdc.address), pad(d.helper.address), BigInt(auth.grossAmount), pad(auth.sourceAccount), BigInt(auth.maxCctpFee), 0n, 0n,
    encodeAbiParameters([{ type: "uint32" }, { type: "bytes32" }], [1, auth.midenRecipient])]);
}
export function sourceFixture() {
  const auth = evmAuthorization(), message = evmMessage(auth), abi = parseAbi(["event MessageSent(bytes message)"]);
  const log = { address: auth.deployment.source.messageTransmitter.address, topics: encodeEventTopics({ abi, eventName: "MessageSent" }),
    data: encodeAbiParameters([{ type: "bytes" }], [message]), logIndex: 2, transactionHash: txHash, blockHash, blockNumber: 101n, transactionIndex: 0, removed: false };
  return { auth, message, receipt: { transactionHash: txHash, blockHash, blockNumber: 101n, transactionIndex: 0, from: sender, to: auth.deployment.source.tokenMessenger.address, status: "success", logs: [log] },
    tx: { hash: txHash, from: sender, to: auth.deployment.source.tokenMessenger.address, value: 0n, input: evmHelperCallData(auth), blockHash, blockNumber: 101n, transactionIndex: 0, nonce: 3 } };
}
export function replaceMessageField(message: `0x${string}`, start: number, length: number, value: string | number) {
  return `${message.slice(0, 2 + start * 2)}${BigInt(value).toString(16).padStart(length * 2, "0")}${message.slice(2 + (start + length) * 2)}` as `0x${string}`;
}
