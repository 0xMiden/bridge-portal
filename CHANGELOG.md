# Changelog

## Unreleased

### Changes

- [CHANGE] **Miden SDK 0.16.2.** `@miden-sdk/miden-sdk` and `@miden-sdk/react` plus the wallet adapters move off 0.15.7 onto the 0.16 line. B2AGG no longer calls `withCallbacks` (the flag is intrinsic to the faucet id). `npm run check:wasm-size` keeps the `st` wasm under 24 MiB.
- [CHANGE] **CI is honest.** PRs now run typecheck, lint (`--max-warnings 0`), unit tests, and mock E2E. The old `e2e` workflow only ran vitest plus mock Playwright and still gated production deploys. Deploy now waits on the `ci` workflow.
- [CHANGE] **npm is the only installer.** Dropped the `packageManager: yarn@4` field that contradicted `package-lock.json` and `npm ci`. Node `>=22` is required, matching CI and the Dockerfile.
- [CHANGE] **`npm run test:e2e:testnet` no longer pretends.** The script named a `playwright.e2e.config.ts` that is not in the tree. It now exits 1 with that message until live testnet E2E lands.
- [CHANGE] **CSP framing is same-origin only.** Removed a personal Tailscale host from `frame-ancestors` and `allowedDevOrigins`.
- [CHANGE] **Unit coverage is collected from every `src` file and gated.** First floor is the measured 12/11/9/12 (statements/branches/functions/lines). Sepolia RPC fallback, B2AGG construction, Epoch taskType, and pin freeze are now unit-tested.
- [CHANGE] **Mock E2E submits all four route x direction cells.** Confirm creates an activity whose tx hash is a 32-byte hex, not a wallet-adapter UUID. Mock Miden `waitForTransaction` now returns a hash; mock Epoch/AggLayer balance paths skip live WASM/RPC.

### Fixes

- [FIX] **Mock E2E no longer hides a failed wallet inject.** `waitForReady()` throwing is a spec failure, not a later `toBeVisible` miss.
- [FIX] **Lint is green** on `TempoReceipt` (hoisted `Token`), `AnimatedNumber` (no ref read during render), `Crossfade` (latest content via `useLayoutEffect`), and `useFlipSwap` (GSAP `contextSafe` at call time).
- [FIX] **Sepolia balance and gas routes honour `AGGLAYER_SEPOLIA_RPC_URL` / `EVM_RPC_URL`.** They previously hard-coded publicnode (#119).
- [FIX] **Epoch Miden→EVM task data uses `TaskType.GetTokenOut`** instead of a string cast (#118).
