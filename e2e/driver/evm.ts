import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { getEnvironmentConfig, isMockRun } from "../config/environments";

// EVM counterparty driver (§3.3): funds the test account and reads on-chain
// state for assertions. Real viem writes with the test key; a no-op in mock mode.

const ERC20_MINT = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

function requireKey(): Hex {
  const key = process.env.E2E_EVM_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("E2E_EVM_PRIVATE_KEY (funded Sepolia test key) is required.");
  return key;
}

function clients() {
  const env = getEnvironmentConfig();
  const account = privateKeyToAccount(requireKey());
  const transport = http(env.sepoliaRpcUrl);
  return {
    env,
    account,
    publicClient: createPublicClient({ chain: sepolia, transport }),
    walletClient: createWalletClient({ account, chain: sepolia, transport }),
  };
}

export function testEvmAddress(): `0x${string}` {
  return privateKeyToAccount(requireKey()).address;
}

/** Fail fast if the test account is below the Sepolia-ETH gas floor. */
export async function ensureSepoliaEth(): Promise<void> {
  if (isMockRun()) return;
  const { env, account, publicClient } = clients();
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance < env.funding.sepoliaEthFloorWei) {
    throw new Error(
      `Sepolia ETH too low on ${account.address}: ${balance} < floor ${env.funding.sepoliaEthFloorWei}. ` +
        `Top up from a Sepolia faucet before running the e2e tier.`,
    );
  }
}

/** Mint fresh test USDC to the test account (public mint — verified on-chain). */
export async function mintUsdc(): Promise<void> {
  if (isMockRun()) return;
  const { env, account, walletClient, publicClient } = clients();
  const data = encodeFunctionData({
    abi: ERC20_MINT,
    functionName: "mint",
    args: [account.address, env.funding.usdcMintAmount],
  });
  const hash = await walletClient.sendTransaction({ to: env.usdcAddress, data });
  await publicClient.waitForTransactionReceipt({ hash, timeout: env.txTimeoutMs });
}

export async function readUsdcBalance(
  address: `0x${string}`,
): Promise<bigint> {
  const { env, publicClient } = clients();
  return publicClient.readContract({
    address: env.usdcAddress,
    abi: ERC20_MINT,
    functionName: "balanceOf",
    args: [address],
  });
}

export async function isSepoliaTxConfirmed(hash: `0x${string}`): Promise<boolean> {
  const { publicClient } = clients();
  const receipt = await publicClient
    .getTransactionReceipt({ hash })
    .catch(() => null);
  return receipt?.status === "success";
}

/** Wait for a real Sepolia receipt and assert it mined successfully. */
export async function waitForSepoliaTxSuccess(
  hash: `0x${string}`,
  timeoutMs = 180_000,
): Promise<boolean> {
  const { publicClient } = clients();
  const receipt = await publicClient
    .waitForTransactionReceipt({ hash, timeout: timeoutMs })
    .catch(() => null);
  return receipt?.status === "success";
}
