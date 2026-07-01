import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @opennextjs/cloudflare consumes the standalone server output.
  output: "standalone",
  // Pin the file-tracing root to this project. Otherwise Next infers a parent
  // dir (a stray ~/package-lock.json) as the workspace root and nests the
  // standalone output under the full path, so opennext can't find
  // .next/standalone/.next/server/*.
  outputFileTracingRoot: __dirname,
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
  // @miden-sdk v0.15's wasm-bindgen glue (dist/st|mt/*.js) opens with CommonJS
  // interop shims, so webpack treats it as CJS and can't see its named
  // re-exports (NoteArray, ForeignAccountArray, …) → "X is not exported".
  // Force ESM parsing for the SDK dist so the named exports resolve. Also alias
  // optional wallet-connector deps we don't use (pulled in by wagmi/AppKit).
  webpack: (config) => {
    config.module = config.module ?? {};
    config.module.rules = config.module.rules ?? [];
    // @miden-sdk's wasm-bindgen glue re-exports its classes (NoteArray, …) through
    // a rollup CJS-interop file, which webpack's static analysis can't follow — it
    // errors "X is not exported" even though the exports exist at runtime. Downgrade
    // the export-presence check for @miden-sdk so the build proceeds; the named
    // exports resolve correctly at runtime via webpack's CJS interop.
    config.module.rules.push({
      test: /\.m?js$/,
      include: /node_modules[\\/]@miden-sdk[\\/]/,
      parser: { exportsPresence: false },
    });
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default nextConfig;
