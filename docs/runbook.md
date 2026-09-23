# Bridge portal runbook

## Live testnet E2E is red

1. Open the failed `e2e-testnet` run and the Playwright trace artifact.
2. Distinguish:
   - Empty faucet / below 0.001 Sepolia ETH: top up the throwaway key.
   - Faucet note never consumed: the seed wallet's first send asks faucet.testnet.miden.io for a public note. A 429 is the faucet rate limit.
   - Kernel skew (`procedure with root digest`): SDK pin is behind the testnet node. Bump `@miden-sdk/miden-sdk`.
   - Allocator 5xx / Epoch quote empty: Epoch testnet is down. Do not "fix" the portal.
   - Activity hash is a UUID: Midenscan link bug; `waitForTransaction` did not return `txHash`.

Until `E2E_EVM_PRIVATE_KEY` and `E2E_MIDEN_SEED` are set, the live suite skips and still counts as green, so production can deploy. After the secrets exist, a red live suite blocks deploy.

## Production looks down

1. `GET https://bridge.miden.xyz/health` - process is up.
2. `GET https://bridge.miden.xyz/health/deep` - Sepolia, Miden RPC, Epoch allocator, AggLayer indexer. 503 names the failed check.
3. The `health` workflow hits `/health/deep` every 20 minutes.

## Pin drift

Nightly `pin-drift` compares portal `@miden-sdk/miden-sdk`, `MIDEN_BRIDGE_ID`, and `MIDEN_AGGLAYER_FAUCET_ID` to `0xMiden/wallet` main. A mismatch fails the workflow and opens/comments an issue. Do not auto-bump; wasm size and the adapter API need a reviewed PR.

## Secrets

Repo Actions secrets (throwaway testnet only):

- `E2E_EVM_PRIVATE_KEY`
- `E2E_MIDEN_SEED` (32 bytes; the harness creates a public wallet from it)
- `E2E_MIDEN_ACCOUNT_ID` (optional; must match that seed's wallet)
- `E2E_SEPOLIA_RPC_URL` (optional keyed RPC)

Production deploy:

- `CLOUDFLARE_API_TOKEN`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (inlined at `cf:build`)

Never set `NEXT_PUBLIC_E2E_*` on a production `cf:build`. `scripts/check-prod-bundle.mjs` fails the deploy if they leak into `.next` / `.open-next`.
