import { encodeFunctionData, pad, parseAbi } from "viem";
import type { EvmManualAuthorization } from "./helper-evm-types";
import { encodeHelperHook } from "./helper-hook";
export const nativeCctpAbi = parseAbi([
  "function depositForBurnWithHook(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes hookData)",
]);
/** Native V2 call binds both mint control fields to the immutable Arc helper. */
export function evmHelperBurnCall(auth: EvmManualAuthorization) {
  return { account: auth.sourceAccount, address: auth.deployment.source.tokenMessenger.address, abi: nativeCctpAbi,
    functionName: "depositForBurnWithHook",
    args: [BigInt(auth.grossAmount), 26, pad(auth.deployment.helper.address), auth.deployment.source.usdc.address,
      pad(auth.deployment.helper.address), BigInt(auth.maxCctpFee), 2000, encodeHelperHook(auth.midenRecipient)],
  } as const;
}
export function evmHelperCallData(auth: EvmManualAuthorization) { return encodeFunctionData(evmHelperBurnCall(auth)); }
export function evmHelperIntent(auth: Pick<EvmManualAuthorization, "deployment" | "sourceAccount" | "grossAmount" | "midenRecipient">) {
  const d = auth.deployment;
  return JSON.stringify([d.environment, d.source.chainId, d.source.domain, d.source.usdc.address.toLowerCase(), d.helper.address.toLowerCase(),
    d.arc.chainId, auth.sourceAccount.toLowerCase(), BigInt(auth.grossAmount).toString(), auth.midenRecipient.toLowerCase()]);
}
