import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, encodePacked, pad, parseAbiParameters, size, slice, stringToHex, type Address, type Hex } from "viem";
import { ARC, xReserveAbi } from "./config";
import { CCTP } from "./cctp-config";
import { arcRecipient } from "./deposit";
import { decodeArcRecipient } from "./attestation";

/** Wire format from the verified GenericExecutor and DepositForHandler on Arc. */
export function cctpDepositHook(sender: Address, recipient: string): Hex {
  const deposit = encodeFunctionData({
    abi: xReserveAbi, functionName: "depositToRemote",
    args: [0n, ARC.midenDomain, arcRecipient(recipient), ARC.usdc, ARC.maxFee, "0x"],
  });
  // The handler injects the minted amount at byte offset 4, after the selector.
  const handlerData = encodeAbiParameters(parseAbiParameters("address,address,bytes,uint256[]"),
    [ARC.xReserve, ARC.xReserve, deposit, [4n]]);
  const payload = encodeAbiParameters(parseAbiParameters("uint8,bytes32,address,bytes"),
    [1, pad(sender), CCTP.handler, handlerData]);
  const frame = (name: string, data: Hex) => encodePacked(
    ["bytes24", "uint32", "uint32", "bytes"],
    [pad(stringToHex(name), { size: 24, dir: "right" }), 1, size(data), data],
  );
  return `${frame("circle-generic-executor", payload)}${frame("cctp-forward", "0x").slice(2)}`;
}

/** Only accept this portal's exact handler, recovery address and deposit terms. */
export function decodeCctpDepositHook(hook: Hex) {
  const payloadLength = Number(BigInt(slice(hook, 28, 32)));
  const [, recovery, , handlerData] = decodeAbiParameters(parseAbiParameters("uint8,bytes32,address,bytes"), slice(hook, 32, 32 + payloadLength));
  if (!/^0x0{24}[\da-f]{40}$/i.test(recovery)) throw new Error("Invalid recovery address.");
  const sender = slice(recovery, 12) as Address;
  const [, , calldata] = decodeAbiParameters(parseAbiParameters("address,address,bytes,uint256[]"), handlerData);
  const decoded = decodeFunctionData({ abi: xReserveAbi, data: calldata });
  if (decoded.functionName !== "depositToRemote") throw new Error("Unsupported deposit hook.");
  const recipient = decodeArcRecipient(decoded.args[2]);
  if (cctpDepositHook(sender, recipient).toLowerCase() !== hook.toLowerCase()) throw new Error("Unsupported deposit hook.");
  return { sender, recipient };
}
