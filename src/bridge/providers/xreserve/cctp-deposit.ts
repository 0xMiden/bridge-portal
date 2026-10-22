import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, custom, erc20Abi, pad, parseAbi, type Address, type Hash } from "viem";
import { ensureEvmNetwork } from "../../../wallets/evm/ensure-network";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { normalizeMidenAccountHex } from "../agglayer/agglayer";
import { arcConfig, xReserveAbi } from "./config";
import { evmReadTransport } from "../../evm/transport";
import { ensureUsdcApproval } from "./approval";
import { arcRecipient, parseArcAmount, type ArcDepositPhase } from "./deposit";
import { cctpConfig, cctpAbi, cctpSource, type CctpNetwork } from "./cctp-config";
import { cctpDepositHook } from "./cctp-hook";
import { fetchCctpQuote, type CctpQuote } from "./cctp-quote";
import { fetchCctpQuoteValidation } from "./cctp-quote-validation";

// Match Circle Bridge Kit 1.16.0: validate against the source-chain tip and
// require >30 seconds, not the advisory blockEstimatedAt or the device clock.
// https://unpkg.com/@circle-fin/bridge-kit@1.16.0/index.mjs
const QUOTE_EXPIRY_SAFETY_SECONDS = 30;

export async function depositViaCctp({ network, provider, account, amount, recipient, quote, onPhase, onBroadcast }: {
  network: CctpNetwork; provider: EvmProvider; account: Address; amount: string; recipient: string;
  quote: CctpQuote; onPhase: (phase: ArcDepositPhase) => void; onBroadcast: (hash: Hash, fee: string) => void;
}, deploymentId?: string) {
  const ARC = arcConfig(deploymentId);
  const arcTestnet = ARC.chain;
  const CCTP = cctpConfig(deploymentId, network);
  const value = parseArcAmount(amount);
  const assertQuoteMatches = (candidate: CctpQuote) => {
    if (candidate.deploymentId !== deploymentId || candidate.network !== network || candidate.sender.toLowerCase() !== account.toLowerCase() ||
        normalizeMidenAccountHex(candidate.recipient) !== normalizeMidenAccountHex(recipient) ||
        parseArcAmount(candidate.amount) !== value)
      throw new Error("The transfer changed. Review its fee again.");
  };
  assertQuoteMatches(quote);
  const { AccountId } = await import("@miden-sdk/miden-sdk");
  const id = AccountId.fromHex(`0x${normalizeMidenAccountHex(recipient)}`);
  id.free();
  onPhase("checking");
  const source = cctpSource(network, deploymentId);
  const arc = createPublicClient({ chain: arcTestnet, transport: evmReadTransport(ARC.network) });
  const pausedAbi = parseAbi(["function paused() view returns (bool)"]);
  const [registered, remoteToken, executorPaused, handlerPaused] = await Promise.all([
    arc.readContract({ address: ARC.xReserve, abi: xReserveAbi, functionName: "isRemoteDomainRegistered", args: [ARC.midenDomain] }),
    arc.readContract({ address: ARC.xReserve, abi: xReserveAbi, functionName: "getRemoteToken", args: [ARC.midenDomain, ARC.usdc] }),
    arc.readContract({ address: CCTP.executor, abi: pausedAbi, functionName: "paused" }),
    arc.readContract({ address: CCTP.handler, abi: pausedAbi, functionName: "paused" }),
  ]);
  if (!registered || remoteToken.toLowerCase() !== arcRecipient(ARC.faucetId) || executorPaused || handlerPaused)
    throw new Error("Circle's Miden deposit route is unavailable. Please try again later.");
  await ensureEvmNetwork(provider, source.chain);
  const client = createPublicClient({ chain: source.chain, transport: evmReadTransport(network) });
  const wallet = createWalletClient({ chain: source.chain, transport: custom(provider) });
  const assertWallet = async () => {
    const accounts = await provider.request<string[]>({ method: "eth_accounts" });
    if (accounts[0]?.toLowerCase() !== account.toLowerCase() ||
        Number(await provider.request({ method: "eth_chainId" })) !== source.chain.id)
      throw new Error("Your wallet account or network changed. Review the transfer again.");
  };
  const isQuoteUsable = async (candidate: CctpQuote) => {
    assertQuoteMatches(candidate);
    // getFee verifies the displayed price against the signed bytes; Circle's
    // validation also checks signature, call bindings and actual chain expiry.
    const [fee, token] = await client.readContract({ address: CCTP.tokenMessengerWithFees, abi: cctpAbi,
      functionName: "getFee", args: [candidate.signedQuote] });
    if (token.toLowerCase() !== source.asset.address.toLowerCase() || fee.toString() !== candidate.fee)
      throw new Error("Circle's signed quote does not match its fee. Review the transfer again.");
    if (fee > BigInt(quote.fee))
      throw new Error("Circle's fee increased. Review the updated fee before sending.");
    const started = performance.now();
    const validation = await fetchCctpQuoteValidation(candidate);
    await assertWallet();
    // Conservatively include the round trip; a delayed response is not fresh.
    const elapsedSeconds = (performance.now() - started) / 1000;
    return validation.claimable && validation.secondsRemaining - elapsedSeconds > QUOTE_EXPIRY_SAFETY_SECONDS;
  };
  const refreshQuote = async () => {
    const fresh = await fetchCctpQuote({ network, sender: account, amount, recipient, ...(deploymentId ? { deploymentId } : {}) });
    if (!await isQuoteUsable(fresh))
      throw new Error("Circle's quote expires too soon. Please review the transfer again.");
    return fresh;
  };
  const ensureUsableQuote = async (current: CctpQuote) => await isQuoteUsable(current) ? current : refreshQuote();
  let fresh = await ensureUsableQuote(quote);
  const approvedTotal = value + BigInt(quote.fee);
  const balance = await client.readContract({ address: source.asset.address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  if (balance < approvedTotal) throw new Error("Not enough USDC to cover the amount and Circle fee.");
  await ensureUsdcApproval({
    network, client, wallet, account, token: source.asset.address,
    spender: CCTP.tokenMessengerWithFees, amount: approvedTotal, assertWallet, onPhase,
  });
  // Preserve the approved price after waiting. A refresh cannot increase the
  // reviewed fee or trigger another approval within this submission.
  await assertWallet();
  fresh = await ensureUsableQuote(fresh);
  for (let attempt = 0; attempt < 2; attempt++) {
    let deposit;
    try {
      deposit = await client.simulateContract({ account, address: CCTP.tokenMessengerWithFees, abi: cctpAbi,
        functionName: "depositForBurnWithHookAndFees", args: [value, ARC.circleDomain, pad(CCTP.executor), source.asset.address,
          pad(CCTP.executor), cctpDepositHook(account, recipient, deploymentId), { signedQuote: fresh.signedQuote, refundAddress: account }],
      });
    } catch (error) {
      const revert = error instanceof BaseError ? error.walk(cause => cause instanceof ContractFunctionRevertedError) : undefined;
      if (attempt === 0 && revert instanceof ContractFunctionRevertedError &&
          revert.data?.errorName === "QuoteExpired" && !await isQuoteUsable(fresh)) {
        fresh = await refreshQuote();
        continue;
      }
      throw error;
    }
    // Simulation/RPC work may consume the window. Rebuild calldata if the quote
    // changes, and never automatically retry after handing it to the wallet.
    if (await isQuoteUsable(fresh)) {
      onPhase("depositing");
      const hash = await wallet.writeContract(deposit.request);
      onBroadcast(hash, fresh.fee);
      return hash;
    }
    if (attempt === 0) fresh = await refreshQuote();
  }
  throw new Error("Circle's quote expired while preparing the deposit. Please review the transfer again.");
}
