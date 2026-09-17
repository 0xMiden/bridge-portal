# Changelog

## Unreleased

### Changes

- [CHANGE] **CI is honest.** PRs now run typecheck, lint (`--max-warnings 0`), unit tests, and mock E2E. The old `e2e` workflow only ran vitest plus mock Playwright and still gated production deploys. Deploy now waits on the `ci` workflow.
- [CHANGE] **npm is the only installer.** Dropped the `packageManager: yarn@4` field that contradicted `package-lock.json` and `npm ci`. Node `>=22` is required, matching CI and the Dockerfile.
- [CHANGE] **`npm run test:e2e:testnet` no longer pretends.** The script named a `playwright.e2e.config.ts` that is not in the tree. It now exits 1 with that message until live testnet E2E lands.
- [CHANGE] **CSP framing is same-origin only.** Removed a personal Tailscale host from `frame-ancestors` and `allowedDevOrigins`.

### Fixes

- [FIX] **Mock E2E no longer hides a failed wallet inject.** `waitForReady()` throwing is a spec failure, not a later `toBeVisible` miss.
- [FIX] **Lint is green** on `TempoReceipt` (hoisted `Token`), `AnimatedNumber` (no ref read during render), `Crossfade` (latest content via `useLayoutEffect`), and `useFlipSwap` (GSAP `contextSafe` at call time).
