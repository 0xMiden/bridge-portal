import Image from "next/image";
import type { BridgeProvider } from "../../bridge/core/models";

const providerLogos = {
  agglayer: "/provider-logos/agglayer.png",
  epoch: "/provider-logos/epoch.png",
  xreserve: "/provider-logos/circle.svg",
} satisfies Record<BridgeProvider, string>;

export function ProviderLogo({ provider }: { provider: BridgeProvider }) {
  return <Image className="provider-logo size-7 shrink-0 object-contain"
    src={providerLogos[provider]} alt="" width={28} height={28} unoptimized />;
}
