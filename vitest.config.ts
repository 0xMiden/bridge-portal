import { defineConfig } from "vitest/config";

// Node unit/integration tests include real SDK codecs where practical.
// Browser lifecycle and UI scenarios run separately with Playwright.
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
