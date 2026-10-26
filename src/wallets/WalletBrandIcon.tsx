"use client";

import { Wallet } from "lucide-react";
import { useState } from "react";

/** Wallet-provider branding, with a neutral fallback for missing or broken images. */
export function WalletBrandIcon({ src, size }: { src?: string; size: number }) {
  const [failedSrc, setFailedSrc] = useState<string>();

  if (!src || src === failedSrc) {
    return <Wallet size={size} className="shrink-0" aria-hidden="true" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- Wallet metadata includes arbitrary remote URLs and SVG data URIs.
    <img
      key={src}
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded object-contain"
      style={{ width: size, height: size }}
      onError={() => setFailedSrc(src)}
    />
  );
}
