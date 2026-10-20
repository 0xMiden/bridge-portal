import Image from "next/image";
import type { BridgeAsset, BridgeNetwork } from "../../bridge/core/assets";

const networkLogos = {
  sepolia: "/asset-logos/ethereum.svg",
  "arc-testnet": "/asset-logos/arc.png",
  "base-sepolia": "/asset-logos/base.svg",
  "arbitrum-sepolia": "/asset-logos/arbitrum.svg",
  "miden-testnet": "/asset-logos/miden.svg",
} satisfies Record<BridgeNetwork, string>;

const tokenLogos: Partial<Record<string, string>> = {
  ETH: "/asset-logos/ethereum.svg",
  USDC: "/asset-logos/usdc.svg",
  USDCx: "/asset-logos/usdc.svg",
  DAI: "/asset-logos/dai.svg",
  USDT: "/asset-logos/usdt.svg",
  WBTC: "/asset-logos/wbtc.svg",
};

/** The adjacent network/token name supplies the accessible label. */
export function NetworkLogo({ network }: { network: BridgeNetwork }) {
  return <Image className="network-logo" src={networkLogos[network]} alt="" width={24} height={24} unoptimized />;
}

export function TokenLogo({ asset }: { asset: BridgeAsset }) {
  const src = tokenLogos[asset.symbol];
  if (!src) return null;

  return (
    <span className="token-logo" aria-hidden="true">
      <Image src={src} alt="" width={32} height={32} unoptimized />
      {/* UI identifier, not a claim that USDCx has its own official brand mark. */}
      {asset.symbol === "USDCx" ? <span className="token-logo-variant">x</span> : null}
    </span>
  );
}
