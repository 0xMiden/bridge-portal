import { parseAbi } from "viem";
import { arcTestnet } from "../../../config/arc";
import { ARC_USDC, MIDEN_USDCX } from "../../core/assets";
export { arcTestnet } from "../../../config/arc";

export const ARC = {
  chainId: arcTestnet.id,
  circleDomain: 26,
  midenDomain: 10007,
  usdc: ARC_USDC.address,
  faucetId: MIDEN_USDCX.faucetId,
  xReserve: "0x008888878f94C0d87defdf0B07f46B93C1934442",
  decimals: 6,
  maxFee: 0n,
  attestationApi: "https://xreserve-api-testnet.circle.com",
  explorer: arcTestnet.blockExplorers.default.url,
} as const;

export const xReserveAbi = parseAbi([
  "function isRemoteDomainRegistered(uint32 remoteDomain) view returns (bool)",
  "function getRemoteToken(uint32 remoteDomain, address localToken) view returns (bytes32)",
  "function depositToRemote(uint256 value, uint32 remoteDomain, bytes32 remoteRecipient, address localToken, uint256 maxFee, bytes hookData)",
  "event DepositedToRemote(address indexed localToken, uint256 value, address indexed localDepositor, bytes32 indexed remoteRecipient, uint32 remoteDomain, bytes32 remoteToken, uint256 maxFee, bytes hookData)",
]);

// miden-protocol AssetAmount::MAX. The faucet cannot mint arbitrary u64 amounts.
export const ARC_MAX_MIDEN_AMOUNT = (1n << 63n) - (1n << 31n);
