import { encodeAbiParameters, encodeEventTopics, keccak256, pad, parseAbi, parseAbiParameters, toHex } from "viem";

const events = parseAbi([
  "event DepositedToMiden(uint32 indexed sourceDomain,bytes32 indexed cctpNonce,bytes32 indexed midenRecipient,uint256 amount)",
  "event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)",
  "event DepositedToRemote(address indexed localToken,uint256 value,address indexed localDepositor,bytes32 indexed remoteRecipient,uint32 remoteDomain,bytes32 remoteToken,uint256 maxFee,bytes hookData)",
]);
const uint = (value, bytes) => BigInt(value).toString(16).padStart(bytes * 2, "0");
const account = id => `0x${id.slice(2).padStart(62, "0")}00`;
export const arcBlockHash = number => `0x${uint(number, 32)}`;

/** ABI-encoded synthetic receipt tuple, served only by the owned loopback harness. */
export function helperReceiptFixture(deployment, record, row, scenario) {
  const transactionHash = keccak256(toHex(record.signature));
  const blockNumber = "0x6a", blockHash = arcBlockHash(106);
  const nonce = `0x${row.message.slice(26, 90)}`, sender = `0x${row.message.slice(90, 154)}`;
  const amount = BigInt(record.amount) - BigInt(scenario.executedFee);
  const common = { blockHash, blockNumber, transactionHash, transactionIndex: "0x0", removed: false };
  const log = (address, eventName, args, types, values, index) => ({ ...common, address, logIndex: `0x${index.toString(16)}`,
    topics: encodeEventTopics({ abi: events, eventName, args }), data: encodeAbiParameters(parseAbiParameters(types), values) });
  const logs = [
    log(deployment.arc.messageTransmitter.address, "MessageReceived", { caller: deployment.helper.address, nonce, finalityThresholdExecuted: 2000 },
      "uint32,bytes32,bytes", [5, sender, `0x${row.message.slice(298)}`], 0),
    log(deployment.arc.xReserve.address, "DepositedToRemote", { localToken: deployment.arc.usdc.address, localDepositor: deployment.helper.address, remoteRecipient: record.recipient },
      "uint256,uint32,bytes32,uint256,bytes", [amount, 10007, account(deployment.miden.faucetId), 0n, "0x"], 1),
    log(deployment.helper.address, "DepositedToMiden", { sourceDomain: 5, cctpNonce: nonce, midenRecipient: record.recipient }, "uint256", [amount], 2),
  ];
  if (scenario.doubleDeposit) logs.push({ ...logs[1], logIndex: "0x3" });
  const payload = reserveNonce => `0x5a2e0acd00000001${uint(amount, 32)}${uint(10007, 4)}${account(deployment.miden.faucetId).slice(2)}${record.recipient.slice(2)}${pad(deployment.arc.usdc.address).slice(2)}${pad(deployment.helper.address).slice(2)}${uint(0, 32)}${uint(reserveNonce, 32)}00000000`;
  return { hash: transactionHash, payload: payload(5678), alternatePayload: payload(5679), receipt: {
    transactionHash, blockHash, blockNumber, logs, from: scenario.arcPayer ?? `0x${"77".repeat(20)}`, to: `0x${"88".repeat(20)}`,
    transactionIndex: "0x0", type: "0x2", status: "0x1", cumulativeGasUsed: "0x186a0", gasUsed: "0x186a0", effectiveGasPrice: "0x1",
    logsBloom: `0x${"00".repeat(256)}`, contractAddress: null,
  } };
}
