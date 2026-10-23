import type { BridgeConfig } from "../../../config/bridge-config";
import { erc20Abi, type Address, type Hash } from "viem";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { prepareDepositWallet, type DepositWallet } from "../../evm/deposit-wallet";
import { arcConfig, xReserveAbi } from "./config";
import { arcRecipient, parseArcAmount } from "./deposit-terms";
import { assertArcRouteAvailable, validateMidenRecipient } from "./deposit-preflight";
import { ensureUsdcApproval } from "./approval";
import { suggestEvmFees } from "../../evm/fee-suggestions";

export type ArcDepositPhase = "checking" | "approving" | "approving-wallet-fees" | "approval-confirming" | "depositing" | "depositing-wallet-fees";

type ArcDepositRequest = {
  provider: EvmProvider;
  account: Address;
  amount: string;
  recipient: string;
  onPhase: (phase: ArcDepositPhase) => void;
  onBroadcast: (hash: Hash) => void;
};

async function approveArcDeposit(input: ArcDepositRequest, connection: DepositWallet, arc: ReturnType<typeof arcConfig>) {
  const amount = parseArcAmount(input.amount);
  const balance = await connection.client.readContract({
    address: arc.usdc, abi: erc20Abi, functionName: "balanceOf", args: [input.account],
  });
  if (balance <= amount) throw new Error(`Keep some USDC on ${arc.chain.name} to pay transaction fees.`);
  await ensureUsdcApproval({
    ...connection, account: input.account, network: arc.network, token: arc.usdc,
    spender: arc.xReserve, amount, onPhase: input.onPhase,
  });
}

export async function depositOnArc(input: ArcDepositRequest, recovery?: BridgeConfig) {
  const { provider, account, amount, recipient, onPhase, onBroadcast } = input;
  const arc = arcConfig(recovery);
  const value = parseArcAmount(amount);
  const remoteRecipient = arcRecipient(recipient);
  await validateMidenRecipient(recipient);
  onPhase("checking");
  const connection = await prepareDepositWallet(arc.network, provider, account);
  await assertArcRouteAvailable(connection.client, arc);
  await approveArcDeposit(input, connection, arc);
  await connection.assertWallet();
  const deposit = await connection.client.simulateContract({
    account, address: arc.xReserve, abi: xReserveAbi, functionName: "depositToRemote",
    args: [value, arc.midenDomain, remoteRecipient, arc.usdc, arc.maxFee, "0x"],
  });
  const fees = await suggestEvmFees(connection.client);
  onPhase(fees ? "depositing" : "depositing-wallet-fees");
  await connection.assertWallet();
  const hash = await connection.wallet.writeContract({ ...deposit.request, ...fees, type: undefined, gasPrice: undefined });
  onBroadcast(hash); // Persist immediately: a later polling error is not a failed deposit.
  return hash;
}
