import "server-only";
import { http } from "viem";

// The public Arc endpoint rate-limits bursts. Share a paced read queue across
// viem clients while retaining ordinary transports for private/fixture RPCs.
let queue: Promise<unknown> = Promise.resolve();
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const pacedFetch: typeof fetch = (input, init) => {
  const operation = queue.then(async () => {
    try {
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(input, init);
        if (response.status !== 429 || attempt === 3) return response;
        await response.body?.cancel(); await pause(500 * 2 ** attempt);
      }
    } finally { await pause(150); }
  });
  queue = operation.catch(() => undefined);
  return operation;
};
export function arcReadTransport(url: string) {
  return http(url, { timeout: 30_000, retryCount: 0, ...(new URL(url).origin === "https://rpc.testnet.arc.io" ? { fetchFn: pacedFetch } : {}) });
}
