import { BaseError, ContractFunctionRevertedError, erc20Abi, type Address, type Hash } from "viem";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { prepareDepositWallet, type DepositWallet } from "../../evm/deposit-wallet";
import { ensureUsdcApproval } from "./approval";
import { cctpBurnCall } from "./cctp-burn";
import { cctpConfig, cctpSource, type CctpNetwork } from "./config";
import { assertCctpQuoteMatches, type CctpQuote, CctpQuotePolicy } from "./cctp-quote";
import type { ArcDepositPhase } from "./deposit";
import { assertCctpRouteAvailable, validateMidenRecipient } from "./deposit-preflight";
import { parseArcAmount } from "./deposit-terms";

type CctpDepositRequest = {
  network: CctpNetwork;
  provider: EvmProvider;
  account: Address;
  amount: string;
  recipient: string;
  quote: CctpQuote;
  onPhase: (phase: ArcDepositPhase) => void;
  onBroadcast: (hash: Hash, fee: string) => void;
};

function isQuoteExpiredRevert(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  const revert = error.walk(cause => cause instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError && revert.data?.errorName === "QuoteExpired";
}

async function prepareBurn(connection: DepositWallet, policy: CctpQuotePolicy, quote: CctpQuote) {
  try {
    return await connection.client.simulateContract(cctpBurnCall(quote));
  } catch (error) {
    if (!isQuoteExpiredRevert(error)) throw error;
    const deadline = await policy.submissionDeadline(quote);
    if (policy.hasSubmissionWindow(deadline)) throw error;
    return null; // An expired simulation may be rebuilt once with a fresh quote.
  }
}

async function submitBurn(connection: DepositWallet, policy: CctpQuotePolicy, quote: CctpQuote, onPhase: CctpDepositRequest["onPhase"]) {
  let currentQuote = quote;
  for (let attempt = 0; attempt < 2; attempt++) {
    const deposit = await prepareBurn(connection, policy, currentQuote);
    const deadline = deposit ? await policy.submissionDeadline(currentQuote) : -Infinity;
    await connection.assertWallet();
    if (deposit && policy.hasSubmissionWindow(deadline)) {
      onPhase("depositing");
      const hash = await connection.wallet.writeContract(deposit.request);
      return { hash, fee: currentQuote.fee };
    }
    if (attempt === 0) currentQuote = await policy.refresh();
  }
  throw new Error("Circle's quote expired while preparing the deposit. Please review the transfer again.");
}

async function approveCctpDeposit(input: CctpDepositRequest, connection: DepositWallet, deploymentId?: string) {
  const token = cctpSource(input.network, deploymentId).asset.address;
  const spender = cctpConfig(deploymentId, input.network).tokenMessengerWithFees;
  const amount = parseArcAmount(input.amount) + BigInt(input.quote.fee);
  const balance = await connection.client.readContract({
    address: token, abi: erc20Abi, functionName: "balanceOf", args: [input.account],
  });
  if (balance < amount) throw new Error("Not enough USDC to cover the amount and Circle fee.");
  await ensureUsdcApproval({
    ...connection, network: input.network, account: input.account,
    token, spender, amount, onPhase: input.onPhase,
  });
}

export async function depositViaCctp(input: CctpDepositRequest, deploymentId?: string) {
  const { network, provider, account, amount, recipient, quote, onPhase, onBroadcast } = input;
  const request = { network, sender: account, amount, recipient, deploymentId };
  assertCctpQuoteMatches(quote, request);
  await validateMidenRecipient(recipient);
  onPhase("checking");
  await assertCctpRouteAvailable(network, deploymentId);
  const connection = await prepareDepositWallet(network, provider, account);
  const policy = new CctpQuotePolicy(request, BigInt(quote.fee), connection.client);
  await policy.verifyAuthorization(quote);
  let selectedQuote = await policy.reuseOrRefresh(quote);
  await approveCctpDeposit(input, connection, deploymentId);
  await connection.assertWallet();
  selectedQuote = await policy.reuseOrRefresh(selectedQuote);
  const result = await submitBurn(connection, policy, selectedQuote, onPhase);
  onBroadcast(result.hash, result.fee);
  return result.hash;
}
