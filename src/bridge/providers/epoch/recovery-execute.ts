"use client";

import { getAccount, getWalletClient } from "@wagmi/core";
import { getAddress, type Address } from "viem";
import { wagmiAdapter } from "../../../wallets/evm/appkit-config";
import { ensureEvmNetwork } from "../../../wallets/evm/ensure-network";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { evmNetworks } from "../../../config/evm-networks";
import type { BridgeEnvironment } from "../../../config/environment";
import { COMPACT_ADDRESS, recoveryAbi, recoveryClient, readLockedDeposit, type LockedDeposit, type RecoveryAction } from "./recovery";

export async function executeRecovery(deposit: LockedDeposit, action: RecoveryAction, sponsor: Address,
  environment: BridgeEnvironment, provider: EvmProvider) {
  const chain = evmNetworks[deposit.asset.network];
  await ensureEvmNetwork(provider, chain);
  const config = wagmiAdapter.wagmiConfig;
  const wallet = await getWalletClient(config, { chainId: chain.id });
  const current = await readLockedDeposit(deposit.asset, environment, sponsor);
  const connected = getAccount(config).address;
  if (!connected || getAddress(connected) !== sponsor || getAddress(wallet.account.address) !== sponsor)
    throw new Error("Your connected wallet changed. Scan the balances again.");
  if (await wallet.getChainId() !== chain.id) throw new Error(`Switch your wallet to ${chain.name}.`);
  const client = recoveryClient(deposit.asset);
  const contract = { address: COMPACT_ADDRESS, abi: recoveryAbi, account: wallet.account, chain };
  let hash;
  switch (action) {
    case "start": {
      if (current.status !== 0) throw new Error("Withdrawal has already started. Refresh the page.");
      if (current.balance === 0n) throw new Error("This lock has no balance to recover.");
      const { request } = await client.simulateContract({ ...contract, functionName: "enableForcedWithdrawal", args: [current.id] });
      hash = await wallet.writeContract(request);
      break;
    }
    case "cancel": {
      if (current.status === 0) throw new Error("This lock has no withdrawal to cancel.");
      const { request } = await client.simulateContract({ ...contract, functionName: "disableForcedWithdrawal", args: [current.id] });
      hash = await wallet.writeContract(request);
      break;
    }
    case "withdraw": {
      if (current.balance === 0n) throw new Error("This lock has no balance to recover.");
      const { request } = await client.simulateContract({ ...contract, functionName: "forcedWithdrawal", args: [current.id, sponsor, current.balance] });
      hash = await wallet.writeContract(request);
      break;
    }
  }
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The recovery transaction failed. Scan the balances again.");
}
