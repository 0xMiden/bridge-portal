import { encodeFunctionData, parseUnits } from "viem";
import { AGGLAYER_BALI } from "./agglayer";
import { type EvmProvider, ensureSepolia } from "./evm-wallet";

// Epoch's Sepolia USDC is a mock ERC20 with a permissionless `mint(to, amount)`
// (0x40c10f19) — the same contract the bridge reads balances from. Minting this
// bootstraps every route: mint USDC -> Epoch receive -> you now hold Miden USDC
// for an Epoch send; bridge ETH in via Agglayer receive -> you hold Miden ETH.
// The Miden-side faucets are dashboard-only (no public endpoint), so those are
// link-outs, not one-click. https://docs.epochprotocol.xyz/supported-chains-and-tokens
export const FAUCET_SEPOLIA_USDC = {
  address: "0x2BB4FfD7E2c6D432b697554Efd77fA13bdbefd69" as `0x${string}`,
  decimals: 18,
  symbol: "USDC",
} as const;

/** Default one-click mint size. */
export const FAUCET_MINT_AMOUNT = "10";

const MINT_ABI = [
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
] as const;

/**
 * Mint testnet USDC to `account` via the mock ERC20's public `mint()`, using the
 * connected Sepolia wallet. Switches the wallet to Sepolia first. Returns the tx
 * hash once the wallet broadcasts it.
 */
export async function mintSepoliaUsdc({
  provider,
  account,
  amount = FAUCET_MINT_AMOUNT,
}: {
  provider: EvmProvider;
  account: string;
  amount?: string;
}): Promise<string> {
  await ensureSepolia(provider);
  const data = encodeFunctionData({
    abi: MINT_ABI,
    functionName: "mint",
    args: [
      account as `0x${string}`,
      parseUnits(amount, FAUCET_SEPOLIA_USDC.decimals),
    ],
  });
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [{ from: account, to: FAUCET_SEPOLIA_USDC.address, data }],
  });
}

/** Sepolia explorer link for a broadcast faucet tx. */
export function sepoliaTxUrl(hash: string): string {
  return `${AGGLAYER_BALI.sepoliaExplorer.replace(/\/$/, "")}/tx/${hash}`;
}

// Assets we can't mint from the connected wallet: gas ETH (never mintable) and
// native Miden testnet tokens. Surface these as external faucet links. The Miden
// faucet is the same one the wallet app opens (faucet.testnet.miden.io).
export const SEPOLIA_ETH_FAUCET_URL =
  "https://cloud.google.com/application/web3/faucet/ethereum/sepolia";
export const MIDEN_TESTNET_FAUCET_URL = "https://faucet.testnet.miden.io";
