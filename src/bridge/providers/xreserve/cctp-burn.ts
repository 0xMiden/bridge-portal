import { pad } from "viem";
import { arcConfig } from "./config";
import { cctpAbi, cctpConfig, cctpSource } from "./cctp-config";
import { cctpDepositHook } from "./cctp-hook";
import { parseArcAmount } from "./deposit-terms";

import type { CctpBurnAuthorization } from "./cctp-schema";
export type { CctpBurnIntent, CctpBurnAuthorization } from "./cctp-schema";

/** The same call is validated by Circle, simulated, and handed to the wallet. */
export function cctpBurnCall(input: CctpBurnAuthorization) {
  const arc = arcConfig(input.deploymentId);
  const source = cctpSource(input.network, input.deploymentId);
  const cctp = cctpConfig(input.deploymentId, input.network);
  return {
    account: input.sender,
    address: cctp.tokenMessengerWithFees,
    abi: cctpAbi,
    functionName: "depositForBurnWithHookAndFees",
    args: [
      parseArcAmount(input.amount),
      arc.circleDomain,
      pad(cctp.executor),
      source.asset.address,
      pad(cctp.executor),
      cctpDepositHook(input.sender, input.recipient, input.deploymentId),
      { signedQuote: input.signedQuote, refundAddress: input.sender },
    ],
  } as const;
}
