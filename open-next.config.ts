import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default Cloudflare config — no incremental cache / tag store needed for this
// app (client-heavy, no ISR). The Miden WASM ships as a client static asset;
// the SSR shell, shared EVM reads and bridge provider APIs run on the Worker.
export default defineCloudflareConfig();
