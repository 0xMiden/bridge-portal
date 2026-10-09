# Changelog

## Unreleased

### Agglayer bridge

- Re-enable ETH deposits only; keep Agglayer withdrawals disabled like USDCx, including saved selections and launch links. Use Gateway's confirmed 2026-10-09 Cardona deployment: rollup 73, Sepolia bridge `0x528e26b25a34a4a5d0dbda1d57d318153d2ed582`, Miden bridge `0x187cabbc404359d16be94954ca9879`, wrapped ETH faucet `0x7c6d1dc7fb7045913d524bbef017f5`, and `https://bridge.miden-testnet.gateway.fm/api`. Track withdrawals under indexer network 73. Epoch remains paused.

### USDCx bridge

- Unify all EVM reads under `/api/evm/[network]` and USDCx quotes/tracking under `/api/xreserve`; remove the separate Arc, CCTP and Sepolia API implementations.

- Add Ethereum Sepolia, Base Sepolia and Arbitrum Sepolia origins via Circle CCTP forwarding through Arc Testnet into Miden Testnet. Show signed Circle fee quotes, approve the reviewed amount plus fee, and correlate the source burn with the Arc executor and Miden deposit. Persist the selected origin and keep source explorer links on the correct chain.
- Fix the Sepolia chain label collapsing to zero width when the amount input claims the grid width; longer origin labels fit on mobile.

- Add Arc Testnet USDC → Miden USDCx through Circle xReserve to the shared route selector, balances, review, activity history, and receipt. Confirming a deposit requests the source wallet network only when needed. Deposits check the current faucet mapping and simulate before signing; saved transfers resume from activity history.
- Keep Miden fixed in the form and let users select an enabled origin chain. Token choices stay on that chain; selecting Arc Testnet resolves to USDC → USDCx without prompting the wallet.
- Upgrade the Miden SDK to 0.17.1 and React/wallet adapters to 0.17.0. Pin the USDCx testnet faucet to `0x4cbdcaffe75f0a317482224dae6436`. Circle attestation remains pending until the exact v0.17 P2ID note is included on Miden; users consume the note in Bread.
- USDCx withdrawals remain unavailable pending a verified withdrawal integration. Existing Epoch/Agglayer deployment pins are unchanged and require separate v0.17 deployment verification.

### Changes

- [CHANGE] **Epoch SDK is pinned to 1.0.39.** Miden collateral uses the SDK's reclaim window and mandate-binding attachment in a custom wallet transaction; both directions use the exported witness schemas.
- [CHANGE] **Production deploys wait on live testnet E2E**, which itself waits on `ci`. The Worker is canaried at `/health/deep` after ship. A production bundle with inlined E2E keys fails the deploy.
- [CHANGE] **`GET /health/deep`** checks Sepolia, Miden RPC, Epoch, and AggLayer. A cron hits it every 20 minutes. `/health` stays liveness-only.
- [CHANGE] **Nightly pin-drift vs wallet main** (SDK version + AggLayer bridge/faucet ids) and a daily floor check on the throwaway Sepolia E2E account.
- [CHANGE] **Live testnet E2E exists.** `npm run test:e2e:testnet` drives the four route x direction cells against Sepolia + Miden. CI runs it on main, serialized, and skips until `E2E_*` secrets are set.
- [CHANGE] **Miden SDK 0.16.2.** `@miden-sdk/miden-sdk` and `@miden-sdk/react` plus the wallet adapters move off 0.15.7 onto the 0.16 line. B2AGG no longer calls `withCallbacks` (the flag is intrinsic to the faucet id). `npm run check:wasm-size` keeps the `st` wasm under 24 MiB.
- [CHANGE] **CI is honest.** PRs now run typecheck, lint (`--max-warnings 0`), unit tests, and mock E2E. The old `e2e` workflow only ran vitest plus mock Playwright and still gated production deploys. Deploy now waits on the `ci` workflow.
- [CHANGE] **npm is the only installer.** Dropped the `packageManager: yarn@4` field that contradicted `package-lock.json` and `npm ci`. Node `>=22` is required, matching CI and the Dockerfile.
- [CHANGE] **`npm run test:e2e:testnet` no longer pretends.** The script named a `playwright.e2e.config.ts` that is not in the tree. It now exits 1 with that message until live testnet E2E lands.
- [CHANGE] **CSP framing is same-origin only.** Removed a personal Tailscale host from `frame-ancestors` and `allowedDevOrigins`.
- [CHANGE] **Unit coverage is collected from every `src` file and gated.** First floor is the measured 12/11/9/12 (statements/branches/functions/lines). Sepolia RPC fallback, B2AGG construction, Epoch taskType, and pin freeze are now unit-tested.
- [CHANGE] **Mock E2E submits all four route x direction cells.** Confirm creates an activity whose tx hash is a 32-byte hex, not a wallet-adapter UUID. Mock Miden `waitForTransaction` now returns a hash; mock Epoch/AggLayer balance paths skip live WASM/RPC.

### Fixes

- [FIX] **Agglayer testnet follows rollup 86 and the current Miden bridge account.** Withdrawal tracking uses the bridge indexer’s local network ID 1, separately from the rollup ID. Deployment pins match wallet main as checked on 2026-09-24.

- [FIX] **Custom Miden bridge-out requests declare a fresh fee-conversion salt.** Epoch and AggLayer now support guarded multisig replay protection, including after the request is serialized to the wallet.

- [FIX] **Epoch quotes use the current Miden 0.16 USDC faucet.** The retired faucet returned `NO_QUOTE_AVAILABLE`; balance reads and test fixtures now use the same current asset.
- [FIX] **Mock E2E no longer hides a failed wallet inject.** `waitForReady()` throwing is a spec failure, not a later `toBeVisible` miss.
- [FIX] **Lint is green** on `TempoReceipt` (hoisted `Token`), `AnimatedNumber` (no ref read during render), `Crossfade` (latest content via `useLayoutEffect`), and `useFlipSwap` (GSAP `contextSafe` at call time).
- [FIX] **Sepolia balance and gas routes honour `AGGLAYER_SEPOLIA_RPC_URL` / `EVM_RPC_URL`.** They previously hard-coded publicnode (#119).
- [FIX] **Epoch Miden→EVM task data uses `TaskType.GetTokenOut`** instead of a string cast (#118).
