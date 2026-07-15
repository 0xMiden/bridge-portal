import { defineConfig } from "vitest/config";

// Unit tier only: fast, pure-logic tests (no DOM, no WASM). Browser-based e2e
// lives under e2e/ and runs via Playwright, never vitest — jsdom can't load the
// Miden/Epoch WASM, so keep the two tiers' runners strictly separate.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
