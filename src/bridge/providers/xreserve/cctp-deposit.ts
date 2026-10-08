import { createPublicClient, createWalletClient, custom, erc20Abi, pad, parseAbi, type Address, type Hash } from "viem";
import { ensureEvmNetwork } from "../../../wallets/evm/ensure-network";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { normalizeMidenAccountHex } from "../agglayer/agglayer";
import { ARC, arcTestnet, xReserveAbi } from "./config";
import { evmReadTransport } from "../../evm/transport";
import { arcRecipient, parseArcAmount, type ArcDepositPhase } from "./deposit";
import { CCTP, cctpAbi, cctpSources, type CctpNetwork } from "./cctp-config";
import { cctpDepositHook } from "./cctp-hook";
import { fetchCctpQuote, type CctpQuote } from "./cctp-quote";

export async function depositViaCctp({ network, provider, account, amount, recipient, quote, onPhase, onBroadcast }: {
  network: CctpNetwork; provider: EvmProvider; account: Address; amount: string; recipient: string;
  quote: CctpQuote; onPhase: (phase: ArcDepositPhase) => void; onBroadcast: (hash: Hash, fee: string) => void;
}) {
  const value = parseArcAmount(amount);
  if (quote.network !== network || quote.sender.toLowerCase() !== account.toLowerCase() ||
      normalizeMidenAccountHex(quote.recipient) !== normalizeMidenAccountHex(recipient) ||
      parseArcAmount(quote.amount) !== value)
    throw new Error("The transfer changed. Review its fee again.");
  const { AccountId } = await import("@miden-sdk/miden-sdk");
  const id = AccountId.fromHex(`0x${normalizeMidenAccountHex(recipient)}`);
  id.free();
  onPhase("checking");
  const source = cctpSources[network];
  const arc = createPublicClient({ chain: arcTestnet, transport: evmReadTransport("arc-testnet") });
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
  const refreshQuote = async () => {
    const fresh = await fetchCctpQuote({ network, sender: account, amount, recipient });
    // Contract decoding independently checks the displayed fee against the signed claim.
    const [fee, token] = await client.readContract({ address: CCTP.tokenMessengerWithFees, abi: cctpAbi,
      functionName: "getFee", args: [fresh.signedQuote] });
    if (token.toLowerCase() !== source.asset.address.toLowerCase() || fee.toString() !== fresh.fee ||
        fee > BigInt(quote.fee) || fresh.expiresAt <= Date.now())
      throw new Error("Circle's fee changed or expired. Review the transfer again.");
    return fresh;
  };
  let fresh = await refreshQuote();
  const approvedTotal = value + BigInt(quote.fee);
  const balance = await client.readContract({ address: source.asset.address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  if (balance < approvedTotal) throw new Error("Not enough USDC to cover the amount and Circle fee.");
  const allowance = await client.readContract({ address: source.asset.address, abi: erc20Abi,
    functionName: "allowance", args: [account, CCTP.tokenMessengerWithFees] });
  if (allowance < approvedTotal) {
    await assertWallet();
    const approval = await client.simulateContract({ account, address: source.asset.address, abi: erc20Abi,
      functionName: "approve", args: [CCTP.tokenMessengerWithFees, approvedTotal] });
    onPhase("approving");
    await assertWallet();
    const hash = await wallet.writeContract(approval.request);
    onPhase("approval-confirming");
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error("USDC approval reverted. No transfer was sent.");
    fresh = await refreshQuote();
  }
  await assertWallet();
  const deposit = await client.simulateContract({ account, address: CCTP.tokenMessengerWithFees, abi: cctpAbi,
    functionName: "depositForBurnWithHookAndFees", args: [value, 26, pad(CCTP.executor), source.asset.address,
      pad(CCTP.executor), cctpDepositHook(account, recipient), { signedQuote: fresh.signedQuote, refundAddress: account }],
  });
  onPhase("depositing");
  await assertWallet();
  const hash = await wallet.writeContract(deposit.request);
  onBroadcast(hash, fresh.fee);
  return hash;
}
