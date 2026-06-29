import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default Cloudflare config — no incremental cache / tag store needed for this
// app (client-heavy, no ISR). The Miden WASM ships as a client static asset;
// only the trivial server code (SSR shell + /api/sepolia/balance) runs on the
// Worker.
export default defineCloudflareConfig();
