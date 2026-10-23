import { createPublicClient, erc20Abi, parseUnits, toHex, type Hex } from "viem";
import type { BridgeRoute } from "../../core/routes";
import type { EvmAsset } from "../../core/assets";
import { evmReadTransport } from "../../evm/transport";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { ensureEvmNetwork } from "../../../wallets/evm/ensure-network";
import { agglayerConfig, buildDepositTransaction } from "./agglayer";
import { evmAddressSchema, transactionHashSchema } from "../../evm/evm-schema";
import { ensureAgglayerApproval } from "./approval";

type DepositRequest = {
  route: BridgeRoute; amount: string; destination: string;
  provider: EvmProvider; address: string; phase: (message: string) => void;
};
type Transaction = ReturnType<typeof buildDepositTransaction>;

function depositWallet({ provider, address }: DepositRequest, config: ReturnType<typeof agglayerConfig>) {
  const assertWallet = async () => {
    const accounts = evmAddressSchema.array().parse(await provider.request({ method: "eth_accounts" }));
    const chainId = Number(await provider.request({ method: "eth_chainId" }));
    if (accounts[0]?.toLowerCase() !== address.toLowerCase() || chainId !== config.chain.id)
      throw new Error("Your wallet account or network changed. Review the transfer again.");
  };
  const send = async (tx: { to: Hex; data: Hex; value: Hex; gas: Hex }) => {
    await assertWallet();
    const hash = await provider.request({
      method: "eth_sendTransaction", params: [{ from: address, chainId: config.sepoliaChainHex, ...tx }],
    });
    return transactionHashSchema.parse(hash);
  };
  return { assertWallet, send };
}

async function prepareTokenDeposit(
  request: DepositRequest, asset: Extract<EvmAsset, { kind: "erc20" }>,
  transaction: Transaction, wallet: ReturnType<typeof depositWallet>,
) {
  const config = agglayerConfig(request.route.recovery);
  const client = createPublicClient({ chain: config.chain, transport: evmReadTransport(config.evmNetwork) });
  const account = evmAddressSchema.parse(request.address);
  const amount = parseUnits(request.amount, asset.decimals);
  request.phase(`Checking ${asset.symbol} allowance…`);
  const balance = await client.readContract({ address: asset.address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  if (balance < amount) throw new Error(`Not enough ${asset.symbol} in your Ethereum wallet.`);
  await ensureAgglayerApproval({
    network: config.evmNetwork, account, token: asset.address, spender: transaction.to,
    symbol: asset.symbol, amount, client, ...wallet, phase: request.phase,
  });
  const estimate = await client.estimateGas({ account, to: transaction.to, data: transaction.data, value: 0n });
  return toHex(estimate * 120n / 100n);
}

export async function submitAgglayerDeposit(request: DepositRequest) {
  const { route, amount, destination, provider, phase } = request;
  const config = agglayerConfig(route.recovery);
  const asset = route.source;
  if (asset.kind === "miden" || asset.network !== config.evmNetwork) throw new Error("Invalid Agglayer deposit route.");
  const transaction = buildDepositTransaction({ amount, asset, midenAccountId: destination }, route.recovery);
  const wallet = depositWallet(request, config);
  await ensureEvmNetwork(provider, config.chain);
  await wallet.assertWallet();
  const gas = asset.kind === "erc20"
    ? await prepareTokenDeposit(request, asset, transaction, wallet) : transaction.gas;
  phase("Confirm the deposit in your wallet…");
  const sourceTxHash = await wallet.send({ to: transaction.to, data: transaction.data, value: transaction.value, gas });
  return { sourceTxHash, destinationAddress: transaction.destinationAddress };
}
