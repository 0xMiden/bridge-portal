import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "homelab.tail477b3c.ts.net"],
  // NOTE: We intentionally do NOT set cross-origin isolation (COOP/COEP/CORP).
  // - COOP: same-origin breaks wallet connectors that rely on popups with
  //   window.opener (e.g. the Coinbase Wallet SDK throws without it).
  //   See https://www.smartwallet.dev/guides/tips/popup-tips#cross-origin-opener-policy
  // - The Miden note transport (transport.miden.io, gRPC-Web) also prefers no
  //   isolation; under COEP it can fail to sync ("MissingContentTypeHeader").
  // Re-introduce only if threaded WASM is needed AND every dependency tolerates it.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://homelab.tail477b3c.ts.net",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
