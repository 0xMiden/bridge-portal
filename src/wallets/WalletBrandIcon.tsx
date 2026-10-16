"use client";

import { Wallet } from "lucide-react";
import { useState } from "react";

/** Wallet-provider branding, with a neutral fallback for missing or broken images. */
export function WalletBrandIcon({ src, size }: { src?: string; size: number }) {
  const [failedSrc, setFailedSrc] = useState<string>();

  if (!src || src === failedSrc) {
    return <Wallet size={size} style={{ flexShrink: 0 }} aria-hidden="true" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- Wallet metadata includes arbitrary remote URLs and SVG data URIs.
    <img
      key={src}
      src={src}
      alt=""
      width={size}
      height={size}
      style={{
        display: "block",
        flexShrink: 0,
        width: size,
        height: size,
        objectFit: "contain",
        borderRadius: 4,
      }}
      onError={() => setFailedSrc(src)}
    />
  );
}
