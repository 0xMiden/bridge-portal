# Changelog

## Unreleased

### Changes

- [CHANGE] **Epoch SDK is upgraded to 2.2.0 with commons SDK 2.1.0.** Quotes and collateral use the API's deployment and timing configuration, fixing the stale Miden arbiter on Polygon withdrawals; deposit recovery follows its Compact address. A versioned patch supports explicitly wallet-paid flows when gasless metadata is omitted and conservatively resets partial allowances when reset policy is unavailable. Live quotes passed in both directions on Ethereum, Base, Arbitrum and Polygon on October 28, 2026. Testnet remains blocked by missing deployment/timing configuration.

- [CHANGE] **Browser tests use simulated wallets without credentials.** Removed live testnet signing, seed-wallet creation, faucet funding, and the funded-account monitor. Production deploys follow successful `ci` on `main`.

- [CHANGE] **Epoch testnet routes are re-enabled.** Sepolia ↔ Miden supports Epoch test USDC, DAI, USDT and WBTC using the v0.17 faucets published by [Epoch's faucet dashboard](https://userdashboard.epochprotocol.xyz/faucets). Retired USDC route IDs remain available for historical receipts; new selections use the current routes. Epoch mock tokens are labeled separately from Circle USDC.
- [CHANGE] **Epoch token availability follows verified allocator estimates.** Both directions returned positive estimates on 2026-10-20 for the enabled token pairs. WETH returned no quote at 0.01, 1 or 10 tokens and is excluded. WBTC deposits quoted at 0.01 and 1 but not 10; every transfer requires a live estimate for its actual amount.
- [CHANGE] **Epoch supports USDCx withdrawals to mock Sepolia USDC.** Miden USDCx can withdraw to Epoch's 18-decimal mock USDC (`0x2BB4FfD7E2c6D432b697554Efd77fA13bdbefd69`). The reverse direction returned no quote at 0.01, 1 or 10 tokens and stays unavailable. This route is separate from Circle USDC ↔ USDCx.
- [CHANGE] **Agglayer ETH deposits and withdrawals are re-enabled.** Saved selections and launch links use Gateway's confirmed 2026-10-09 Cardona deployment: rollup 73, Sepolia bridge `0x528e26b25a34a4a5d0dbda1d57d318153d2ed582`, Miden bridge `0x187cabbc404359d16be94954ca9879`, wrapped ETH faucet `0x7c6d1dc7fb7045913d524bbef017f5`, and `https://bridge.miden-testnet.gateway.fm/api`. Withdrawals are tracked under indexer network 73.
- [CHANGE] **USDCx testnet withdrawals support Arc, Sepolia, Base and Arbitrum.** Bread signs burn notes after live faucet checks, and the app saves a submission receipt. Live Circle fee and net-payout estimates appear before signing; final USDC payout requires verification in the destination wallet until the attester exposes its withdrawal mapping.
- [CHANGE] **EVM reads and USDCx APIs use shared endpoints.** All EVM reads use `/api/evm/[network]`, and USDCx quotes/tracking use `/api/xreserve`; the separate Arc, CCTP and Sepolia API implementations are removed.
- [CHANGE] **USDCx deposits support Ethereum Sepolia, Base Sepolia and Arbitrum Sepolia origins.** Circle CCTP forwards deposits through Arc Testnet into Miden Testnet. The app shows signed Circle fee quotes, approves the reviewed amount plus fee, and correlates the source burn with the Arc executor and Miden deposit. The selected origin persists, and source explorer links stay on the correct chain.
- [CHANGE] **Arc Testnet USDC deposits deliver Miden USDCx through Circle xReserve.** The route joins the shared selector, balances, review, activity history, and receipt. Confirming a deposit requests the source wallet network only when needed. Deposits check the current faucet mapping and simulate before signing; saved transfers resume from activity history.
- [CHANGE] **Miden stays fixed while users select an enabled origin chain.** Token choices stay on that chain; selecting Arc Testnet resolves to USDC → USDCx without prompting the wallet.
- [CHANGE] **Miden SDK is upgraded to 0.17.1 and React/wallet adapters to 0.17.0.** The USDCx testnet faucet is pinned to `0x4cbdcaffe75f0a317482224dae6436`. Circle attestation remains pending until the exact v0.17 P2ID note is included on Miden; users consume the note in Bread.
- [CHANGE] **The initial v0.17 upgrade keeps unverified routes unavailable.** USDCx withdrawals await a verified withdrawal integration. Existing Epoch/Agglayer deployment pins remain unchanged and require separate v0.17 deployment verification.
- [CHANGE] **Epoch SDK is pinned to 1.0.39.** Miden collateral uses the SDK's reclaim window and mandate-binding attachment in a custom wallet transaction; both directions use the exported witness schemas.
- [CHANGE] **`GET /health/deep`** checks Sepolia, Miden RPC, Epoch, and AggLayer. A cron hits it every 20 minutes. `/health` stays liveness-only.
- [CHANGE] **Nightly pin-drift vs wallet main** (SDK version + AggLayer bridge/faucet ids).
- [CHANGE] **Miden SDK 0.16.2.** `@miden-sdk/miden-sdk` and `@miden-sdk/react` plus the wallet adapters move off 0.15.7 onto the 0.16 line. B2AGG no longer calls `withCallbacks` (the flag is intrinsic to the faucet id). `npm run check:wasm-size` keeps the `st` wasm under 24 MiB.
- [CHANGE] **CI is honest.** PRs now run typecheck, lint (`--max-warnings 0`), unit tests, and browser integration tests. The old `e2e` workflow only ran vitest plus mock Playwright and still gated production deploys. Deploy now waits on the `ci` workflow.
- [CHANGE] **npm is the only installer.** Dropped the `packageManager: yarn@4` field that contradicted `package-lock.json` and `npm ci`. Node `>=22` is required, matching CI and the Dockerfile.
- [CHANGE] **CSP framing is same-origin only.** Removed a personal Tailscale host from `frame-ancestors` and `allowedDevOrigins`.
- [CHANGE] **Unit coverage is collected from every `src` file and gated.** First floor is the measured 12/11/9/12 (statements/branches/functions/lines). Sepolia RPC fallback, B2AGG construction, Epoch taskType, and pin freeze are now unit-tested.
- [CHANGE] **Browser tests exercise the production application.** Removed alternate wallet providers, build flags and fabricated Epoch success. Extension transports now live in Playwright. Transaction checks decode real EVM calldata and serialized Miden notes; live settlement requires a manual testnet release check.

### Fixes

- [FIX] **Epoch mainnet uses `https://mainnet-api.epochprotocol.xyz`.** New quotes and transfers use Epoch's updated Smallocator API host; saved receipts retain compatibility with the previous service root.
- [FIX] **DAI, USDT and WBTC display token logos.** Epoch token selectors and selected-token displays show the corresponding logo on both Sepolia and Miden.
- [FIX] **Epoch rejects missing, zero or malformed output estimates before signing.** Preview and execution validate the allocator's output even when the SDK reports success, including the fresh quote requested immediately before collateral signing.
- [FIX] **The Sepolia chain label retains its width beside the amount input.** Longer origin labels fit on mobile instead of collapsing to zero width when the input claims the grid width.
- [FIX] **Agglayer testnet follows rollup 86 and the current Miden bridge account.** Withdrawal tracking uses the bridge indexer’s local network ID 1, separately from the rollup ID. Deployment pins match wallet main as checked on 2026-09-24.

- [FIX] **Custom Miden bridge-out requests declare a fresh fee-conversion salt.** Epoch and AggLayer now support guarded multisig replay protection, including after the request is serialized to the wallet.

- [FIX] **Epoch quotes use the current Miden 0.16 USDC faucet.** The retired faucet returned `NO_QUOTE_AVAILABLE`; balance reads and test fixtures now use the same current asset.
- [FIX] **Mock E2E no longer hides a failed wallet inject.** `waitForReady()` throwing is a spec failure, not a later `toBeVisible` miss.
- [FIX] **Lint is green** on `TempoReceipt` (hoisted `Token`), `AnimatedNumber` (no ref read during render), `Crossfade` (latest content via `useLayoutEffect`), and `useFlipSwap` (GSAP `contextSafe` at call time).
- [FIX] **Sepolia balance and gas routes honour `AGGLAYER_SEPOLIA_RPC_URL` / `EVM_RPC_URL`.** They previously hard-coded publicnode (#119).
- [FIX] **Epoch Miden→EVM task data uses `TaskType.GetTokenOut`** instead of a string cast (#118).
