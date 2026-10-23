import { createPublicClient, encodeFunctionData, erc20Abi, parseUnits, toHex, type Hex } from "viem";
import type { BridgeRoute } from "../../core/routes";
import { evmReadTransport } from "../../evm/transport";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { ensureEvmNetwork } from "../../../wallets/evm/ensure-network";
import { agglayerConfig, buildDepositTransaction } from "./agglayer";

export async function submitAgglayerDeposit({
  route, amount, destination, provider, address, phase,
}: {
  route: BridgeRoute;
  amount: string;
  destination: string;
  provider: EvmProvider;
  address: string;
  phase: (message: string) => void;
}) {
  const config = agglayerConfig(route.recovery);
  const asset = route.source;
  if (asset.kind === "miden" || asset.network !== config.evmNetwork) throw new Error("Invalid Agglayer deposit route.");
  const transaction = buildDepositTransaction({ amount, asset, midenAccountId: destination }, route.recovery);
  const account = address as Hex;
  const assertWallet = async () => {
    const accounts = await provider.request<string[]>({ method: "eth_accounts" });
    if (accounts[0]?.toLowerCase() !== address.toLowerCase() ||
        Number(await provider.request({ method: "eth_chainId" })) !== config.chain.id) {
      throw new Error("Your wallet account or network changed. Review the transfer again.");
    }
  };
  const send = async (tx: { to: Hex; data: Hex; value: Hex; gas: Hex }) => {
    await assertWallet();
    return provider.request<Hex>({
      method: "eth_sendTransaction",
      params: [{ from: address, chainId: config.sepoliaChainHex, ...tx }],
    });
  };
  await ensureEvmNetwork(provider, config.chain);
  await assertWallet();
  let gas = transaction.gas;
  if (asset.kind === "erc20") {
    const client = createPublicClient({ chain: config.chain, transport: evmReadTransport(config.evmNetwork) });
    const amountRaw = parseUnits(amount, asset.decimals);
    const token = { address: asset.address, abi: erc20Abi } as const;
    const readAllowance = () => client.readContract({
      ...token, functionName: "allowance", args: [account, transaction.to],
    });
    phase(`Checking ${asset.symbol} allowance…`);
    const [balance, allowance] = await Promise.all([
      client.readContract({ ...token, functionName: "balanceOf", args: [account] }),
      readAllowance(),
    ]);
    if (balance < amountRaw) throw new Error(`Not enough ${asset.symbol} in your Ethereum wallet.`);

    const approve = async (value: bigint) => {
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [transaction.to, value] });
      const request = { account, to: asset.address, data };
      // USDT returns no bytes from approve. Accept empty data, but never a
      // returned false; the mined allowance is checked before the next step.
      const result = await client.call(request);
      if (result.data && result.data !== "0x" && BigInt(result.data) !== 1n) {
        throw new Error(`${asset.symbol} approval was refused by the token contract.`);
      }
      const approvalGas = await client.estimateGas(request);
      phase(value === 0n ? `Reset ${asset.symbol} approval in your wallet…` : `Approve ${asset.symbol} in your wallet…`);
      const hash = await send({ to: asset.address, data, value: "0x0", gas: toHex(approvalGas * 120n / 100n) });
      phase(`Waiting for ${asset.symbol} approval confirmation…`);
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`${asset.symbol} approval failed. Review the transfer again.`);
      const confirmed = await readAllowance();
      if (value === 0n ? confirmed !== 0n : confirmed < amountRaw) {
        throw new Error(`${asset.symbol} allowance was not updated. Review the transfer again.`);
      }
    };
    if (allowance < amountRaw) {
      // A zero reset supports USDT and avoids changing one nonzero allowance
      // directly into another. Each approval is bounded to this transfer.
      if (allowance > 0n) await approve(0n);
      await approve(amountRaw);
    }
    const estimate = await client.estimateGas({ account, to: transaction.to, data: transaction.data, value: 0n });
    gas = toHex(estimate * 120n / 100n);
  }
  phase("Confirm the deposit in your wallet…");
  const sourceTxHash = await send({ to: transaction.to, data: transaction.data, value: transaction.value, gas });
  return { sourceTxHash, destinationAddress: transaction.destinationAddress };
}
