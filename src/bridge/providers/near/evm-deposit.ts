import { requireEvmWallet } from "../../../wallets/bridge-wallet";
import { decodeFunctionResult, encodeFunctionData, erc20Abi, formatUnits, toHex } from "viem";
import { isEvmAsset } from "../../core/assets";
import type { SubmissionContext } from "../../core/submission";
import { prepareDepositWallet } from "../../evm/deposit-wallet";
import { suggestEvmFees } from "../../evm/fee-suggestions";
import { evmAddressSchema } from "../../evm/evm-schema";
import { evmNetworks } from "../../../config/evm-networks";
import type { NearQuoteResponse } from "./schema";

/** Fund the quoted address directly; ERC-20 deposits need no approval/spender. */
export async function prepareEvmDeposit(context: SubmissionContext, quote: NearQuoteResponse) {
  const { route, input, phase } = context;
  const asset = route.source;
  if (route.mode !== "receive" || !isEvmAsset(asset)) throw new Error("Connect the source EVM wallet.");
  const { provider } = requireEvmWallet(input.externalWallet);
  const account = evmAddressSchema.parse(input.externalAddress);
  const depositAddress = evmAddressSchema.parse(quote.quote.depositAddress);
  const units = BigInt(quote.quote.amountIn);
  const chain = evmNetworks[asset.network];
  phase(`Checking ${asset.symbol} balance and network fee…`);
  const { client, assertWallet } = await prepareDepositWallet(asset.network, provider, account);
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
  const send = () => provider.request<string>({
    method: "eth_sendTransaction", params: [{ from: account, to: transaction.to, data: transaction.data,
      value: toHex(transaction.value), chainId: toHex(chain.id), gas: toHex(gas),
      ...(fees ? { maxFeePerGas: toHex(fees.maxFeePerGas), maxPriorityFeePerGas: toHex(fees.maxPriorityFeePerGas) } : { gasPrice: toHex(gasPrice) }),
    }],
  });
  return {
    assertWallet,
    networkFee: `${formatUnits(fee, chain.nativeCurrency.decimals)} ${chain.nativeCurrency.symbol}`,
    prompt: "Confirm the deposit in your EVM wallet…",
    prepareSend: async () => { await assertWallet(); return send; },
  };
}
