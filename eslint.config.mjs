import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import sonarjs from "eslint-plugin-sonarjs";
import maxBooleanClauses from "./scripts/eslint/max-boolean-clauses.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Apply the gates to wallet schemas, quote, approval, and status implementations, including
    // helpers added later. Consumer-only adaptations keep the shared policy here.
    files: [
      "src/config/wallet-config/schema*.ts",
      "src/bridge/core/quote.ts",
      "src/bridge/evm/approval-store.ts",
      "src/bridge/miden-address*.ts",
      "src/bridge/miden-rpc*.ts",
      "src/bridge/providers/agglayer/**/*.ts",
      "src/app/api/agglayer/**/route.ts",
      "src/bridge/evm/deposit-wallet.ts",
      "src/bridge/evm/evm-schema.ts",
      "src/bridge/evm/source-transaction*.ts",
      "src/bridge/evm/transaction-receipt.ts",
      "src/bridge/providers/xreserve/approval*.ts",
      "src/bridge/providers/xreserve/arc-status-*.ts",
      "src/bridge/providers/xreserve/cctp-*.ts",
      "src/bridge/providers/xreserve/circle-*.ts",
      "src/bridge/providers/xreserve/config.ts",
      "src/bridge/providers/xreserve/deposit*.ts",
      "src/bridge/providers/xreserve/withdrawal-quote*.ts",
      "src/bridge/providers/xreserve/withdrawal.ts",
      "src/app/api/xreserve/quote/**/route.ts",
      "src/app/api/xreserve/withdrawal-quote/route.ts",
      "src/app/api/xreserve/status/route.ts",
    ],
    ignores: ["**/*.test.ts"],
    plugins: {
      sonarjs,
      bridge: { rules: { "max-boolean-clauses": maxBooleanClauses } },
    },
    rules: {
      "sonarjs/cognitive-complexity": ["error", 10],
      "max-depth": ["error", 2],
      "bridge/max-boolean-clauses": "error",
      "max-lines-per-function": ["error", { max: 40, skipBlankLines: true, skipComments: true }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
  // Playwright harness/specs (node, not React). Its fixture `use` param trips
  // the react-hooks rule, which doesn't apply here.
  {
    files: ["e2e/**/*.ts", "playwright.*.config.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
]);

export default eslintConfig;
