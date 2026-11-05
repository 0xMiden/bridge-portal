import { decodeArcRecipient } from "./attestation";
import { formatUnits } from "viem";
import { createActivity } from "../../../app/lib/bridge-presentation";
import { receiptRouteSchema } from "../../core/receipt-route";
import { evmHelperActivitySchema, type EvmHelperActivity } from "./helper-evm-types";
import { evmHelperIntent, evmHelperCallData } from "./helper-evm-call";
import type { BridgeRoute } from "../../core/routes";
/** Restore the original saved terms, even when release routes or ordinary activity storage changed. */
export function restoreEvmJournalReceipt(value: EvmHelperActivity) {
  const row = evmHelperActivitySchema.parse(value), auth = row.authorization, d = auth.deployment;
  if (row.intent !== evmHelperIntent(auth) || row.callData !== evmHelperCallData(auth)) throw new Error("Saved EVM intent is inconsistent.");
  const route: BridgeRoute = { id: `${d.environment}:cctp-helper-evm-${d.source.network}:${d.deploymentId}`, provider: "xreserve", mode: "receive",
    source: { kind: "erc20", network: d.source.network, address: d.source.usdc.address, decimals: 6, symbol: "USDC", logo: "/asset-logos/usdc.svg" },
    destination: { kind: "miden", network: d.environment === "mainnet" ? "miden-mainnet" : "miden-testnet", faucetId: d.miden.faucetId,
      decimals: 6, symbol: "USDCx", logo: "/asset-logos/usdc.svg" },
    recovery: row.recovery, transport: "cctp-helper-evm", execution: "manual", evmHelperDeployment: d, disabled: true };
  receiptRouteSchema.parse(route);
  const midenAccount = decodeArcRecipient(auth.midenRecipient);
  return createActivity(route, formatUnits(BigInt(auth.grossAmount), 6), { id: `act-${row.attemptId}`, cctpEvmHelper: row,
    evmAddress: auth.sourceAccount, midenAccount, destination: midenAccount, sourceTxHash: row.hash,
    midenAccountHex: midenAccount, receivedAmount: formatUnits(BigInt(auth.minimumNet), 6) });
}
