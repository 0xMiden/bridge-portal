import Image from "next/image";
import type { BridgeAsset, BridgeNetwork } from "../../bridge/core/assets";

const networkLogos = {
  polygon: "/asset-logos/polygon.svg",
  ethereum: "/asset-logos/ethereum.svg", arc: "/asset-logos/arc.png", base: "/asset-logos/base.svg", arbitrum: "/asset-logos/arbitrum.svg", "miden-mainnet": "/asset-logos/miden.svg",
  sepolia: "/asset-logos/ethereum.svg",
  "arc-testnet": "/asset-logos/arc.png",
  "base-sepolia": "/asset-logos/base.svg",
  "arbitrum-sepolia": "/asset-logos/arbitrum.svg",
  "miden-testnet": "/asset-logos/miden.svg",
} satisfies Record<BridgeNetwork, string>;

const networkLogoStyles = {
  default: "size-6",
  selector: "size-5",
  endpoint: "size-8 rounded-full bg-field p-1",
};

/** The adjacent network/token name supplies the accessible label. */
export function NetworkLogo({ network, variant = "default" }: {
  network: BridgeNetwork;
  variant?: keyof typeof networkLogoStyles;
}) {
  return <Image className={`network-logo shrink-0 object-contain ${networkLogoStyles[variant]}`}
    src={networkLogos[network]} alt="" width={24} height={24} unoptimized />;
}

export function TokenLogo({ asset, compact = false }: { asset: BridgeAsset; compact?: boolean }) {
  const src = asset.logo;
  if (!src) return null;

  return (
    <span className={`token-logo relative shrink-0 ${compact ? "size-7" : "size-8"}`} aria-hidden="true">
      <Image className={`size-full object-contain ${src === "/asset-logos/near.svg" ? "dark:invert" : ""}`}
        src={src} alt="" width={32} height={32} unoptimized />
      {/* UI identifier, not a claim that USDCx has its own official brand mark. */}
      {asset.symbol === "USDCx" ? <span className="token-logo-variant absolute -right-[3px] -bottom-0.5 grid size-[15px] place-items-center rounded-full border-2 border-surface bg-foreground font-[system-ui] text-[10px]/none font-semibold text-surface">x</span> : null}
    </span>
  );
}
