import { decodeFunctionResult, encodeFunctionData, erc20Abi, formatUnits, toHex } from "viem";
import type { SubmissionContext } from "../../core/submission";
import { prepareDepositWallet } from "../../evm/deposit-wallet";
import { suggestEvmFees } from "../../evm/fee-suggestions";
import { evmAddressSchema, transactionHashSchema } from "../../evm/evm-schema";
import { evmNetworks } from "../../../config/evm-networks";
import { normalizeMidenAccountHex } from "../../miden-address";
import { nearInput, verifyNearQuote } from "./quote";
import { nearPost } from "./client";
import type { NearQuoteResponse } from "./schema";

/** Fund the quoted address directly; ERC-20 deposits need no approval/spender. */
export async function submitNearEvmDeposit(context: SubmissionContext, quote: NearQuoteResponse, id: string) {
  const { route, input, phase } = context;
  const asset = route.source;
  if (route.mode !== "receive" || asset.kind === "miden" || !input.evmWallet.provider) throw new Error("Connect the source EVM wallet.");
  const account = evmAddressSchema.parse(input.evmAddress);
  const depositAddress = evmAddressSchema.parse(quote.quote.depositAddress);
  const units = BigInt(quote.quote.amountIn);
  const chain = evmNetworks[asset.network];
  phase(`Checking ${asset.symbol} balance and network fee…`);
  const { client, assertWallet } = await prepareDepositWallet(asset.network, input.evmWallet.provider, account);
  await assertWallet();
  const nativeBalance = await client.getBalance({ address: account });
  const transaction = asset.kind === "native"
    ? { to: depositAddress, value: units, data: "0x" as const }
    : { to: asset.address, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [depositAddress, units] }) };
  if (asset.kind === "erc20") {
    const balance = await client.readContract({ address: asset.address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
    if (balance < units) throw new Error(`Not enough ${asset.symbol} in your source wallet.`);
    const result = await client.call({ ...transaction, account });
    // USDT can return no data; tokens that explicitly return false did not transfer.
    if (result.data && result.data !== "0x" && !decodeFunctionResult({ abi: erc20Abi, functionName: "transfer", data: result.data })) {
      throw new Error("The token rejected this deposit. No transaction was sent.");
    }
  }
  const [estimate, fees] = await Promise.all([client.estimateGas({ ...transaction, account }), suggestEvmFees(client)]);
  const gas = (estimate * 120n + 99n) / 100n;
  const gasPrice = fees?.maxFeePerGas ?? await client.getGasPrice();
  const fee = gas * gasPrice;
  if (nativeBalance < transaction.value + fee) throw new Error(`Not enough ${chain.nativeCurrency.symbol} for the deposit and network fee.`);
  const binding = nearInput({ route, ...input });
  await nearPost("prepare", { ...binding, quote });
  await assertWallet();
  verifyNearQuote(quote, binding, false);
  const operation = { quote, networkFee: `${formatUnits(fee, chain.nativeCurrency.decimals)} ${chain.nativeCurrency.symbol}`,
    submission: "prepared" as const, status: "PENDING_DEPOSIT" as const, notification: "pending" as const };
  context.persist!({ id, near: operation, receivedAmount: input.quote!.received, evmAddress: input.evmAddress,
    destination: input.midenAccount, midenAccount: input.midenAccount, midenAccountHex: normalizeMidenAccountHex(input.midenAccount),
    eta: `About ${quote.quote.timeEstimate} seconds` });
  context.persist!({ near: { ...operation, submission: "attempted" } });
  phase("Confirm the deposit in your EVM wallet…");
  // One wallet call, with no automatic retry if the wallet response is lost.
  const sourceTxHash = transactionHashSchema.parse(await input.evmWallet.provider.request({
    method: "eth_sendTransaction", params: [{ from: account, to: transaction.to, data: transaction.data,
      value: toHex(transaction.value), chainId: toHex(chain.id), gas: toHex(gas),
      ...(fees ? { maxFeePerGas: toHex(fees.maxFeePerGas), maxPriorityFeePerGas: toHex(fees.maxPriorityFeePerGas) } : { gasPrice: toHex(gasPrice) }),
    }],
  }));
  context.persist!({ sourceTxHash, near: { ...operation, submission: "accepted" } });
  try {
    await nearPost("deposit/submit", { routeId: route.id, quote, txHash: sourceTxHash });
    context.update({ near: { ...operation, submission: "accepted", notification: "sent" } });
  } catch { /* Status tracking retries the notification; it never resends funds. */ }
}
