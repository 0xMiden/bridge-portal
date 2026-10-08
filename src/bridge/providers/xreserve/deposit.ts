import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  pad,
  parseUnits,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { normalizeMidenAccountHex } from "../agglayer/agglayer";
import { ARC, ARC_MAX_MIDEN_AMOUNT, arcTestnet, xReserveAbi } from "./config";
import { evmReadTransport } from "../../evm/transport";

export function parseArcAmount(amount: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount.trim())) {
    throw new Error("Enter a USDC amount with at most 6 decimal places.");
  }
  const value = parseUnits(amount.trim(), ARC.decimals);
  if (value <= 0n || value > ARC_MAX_MIDEN_AMOUNT)
    throw new Error("USDC amount is outside the supported range.");
  return value;
}

export function arcRecipient(address: string): Hex {
  // EthEmbeddedAccountId: append the suffix padding byte, THEN left-pad.
  const hex = normalizeMidenAccountHex(address);
  return pad(`0x${hex}00`, { size: 32 });
}

export async function ensureArc(provider: EvmProvider) {
  const chainId = `0x${ARC.chainId.toString(16)}`;
  if (Number(await provider.request({ method: "eth_chainId" })) === ARC.chainId)
    return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      Number(error.code) !== 4902
    )
      throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: arcTestnet.name,
          nativeCurrency: arcTestnet.nativeCurrency,
          rpcUrls: arcTestnet.rpcUrls.default.http,
          blockExplorerUrls: [ARC.explorer],
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  }
  if (Number(await provider.request({ method: "eth_chainId" })) !== ARC.chainId)
    throw new Error("Switch your wallet to Arc Testnet.");
}

export type ArcDepositPhase =
  "checking" | "approving" | "approval-confirming" | "depositing";

export async function depositOnArc({
  provider,
  account,
  amount,
  recipient,
  onPhase,
  onBroadcast,
}: {
  provider: EvmProvider;
  account: Address;
  amount: string;
  recipient: string;
  onPhase: (phase: ArcDepositPhase) => void;
  // Persist immediately after broadcast; a later polling failure is NOT a failed deposit.
  onBroadcast: (hash: Hash) => void;
}) {
  const value = parseArcAmount(amount);
  const remoteRecipient = arcRecipient(recipient);
  // Validate the actual AccountId structure with the installed SDK before locking USDC.
  const { AccountId } = await import("@miden-sdk/miden-sdk");
  const recipientId = AccountId.fromHex(`0x${normalizeMidenAccountHex(recipient)}`);
  recipientId.free();
  onPhase("checking");
  await ensureArc(provider);
  const client = createPublicClient({ chain: arcTestnet, transport: evmReadTransport("arc-testnet") });
  const wallet = createWalletClient({
    chain: arcTestnet,
    transport: custom(provider),
  });
  const assertWallet = async () => {
    const accounts = await provider.request<string[]>({
      method: "eth_accounts",
    });
    if (accounts[0]?.toLowerCase() !== account.toLowerCase())
      throw new Error("Your wallet account changed. Review the deposit again.");
    if (
      Number(await provider.request({ method: "eth_chainId" })) !== ARC.chainId
    )
      throw new Error(
        "Your wallet network changed. Switch to Arc Testnet and review again.",
      );
  };
  const registered = await client.readContract({
    address: ARC.xReserve,
    abi: xReserveAbi,
    functionName: "isRemoteDomainRegistered",
    args: [ARC.midenDomain],
  });
  if (!registered)
    throw new Error(
      "Miden deposits are not registered on this Arc Testnet contract yet.",
    );
  const remoteToken = await client.readContract({
    address: ARC.xReserve,
    abi: xReserveAbi,
    functionName: "getRemoteToken",
    args: [ARC.midenDomain, ARC.usdc],
  });
  if (remoteToken.toLowerCase() !== arcRecipient(ARC.faucetId))
    throw new Error("Circle has not configured the current Miden USDCx faucet. Please try again later.");
  const balance = await client.readContract({
    address: ARC.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
  if (balance <= value)
    throw new Error("Keep some USDC on Arc Testnet to pay transaction fees.");
  const allowance = await client.readContract({
    address: ARC.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, ARC.xReserve],
  });
  if (allowance < value) {
    await assertWallet();
    const approval = await client.simulateContract({
      account,
      address: ARC.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [ARC.xReserve, value],
    });
    onPhase("approving");
    await assertWallet();
    const hash = await wallet.writeContract(approval.request);
    onPhase("approval-confirming");
    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: 120_000,
    });
    if (receipt.status !== "success")
      throw new Error("USDC approval reverted. No deposit was sent.");
  }
  await assertWallet();
  const deposit = await client.simulateContract({
    account,
    address: ARC.xReserve,
    abi: xReserveAbi,
    functionName: "depositToRemote",
    args: [value, ARC.midenDomain, remoteRecipient, ARC.usdc, ARC.maxFee, "0x"],
  });
  onPhase("depositing");
  await assertWallet();
  const hash = await wallet.writeContract(deposit.request);
  onBroadcast(hash);
  return hash;
}
