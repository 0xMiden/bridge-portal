import { defineConfig } from "vitest/config";

// Unit tier only: fast, pure-logic tests (no DOM, no WASM). Browser-based e2e
// lives under e2e/ and runs via Playwright, never vitest — jsdom can't load the
// Miden/Epoch WASM, so keep the two tiers' runners strictly separate.
export default defineConfig({
  test: {
    environment: "node",
    // Epoch publishes extensionless ESM imports; resolve them as the app bundler does.
    server: { deps: { inline: [/@epoch-protocol\//] } },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/*.d.ts",
        "src/app/lib/e2e/**",
        "src/app/lib/activity-demo.ts",
        "src/app/components/motion/**",
      ],
      // First measured floor after collectCoverageFrom (2026-09-18). Raise
      // as execute/API tests land; never lower.
      thresholds: {
        statements: 12,
        branches: 11,
        functions: 9,
        lines: 12,
      },
    },
  },
});
