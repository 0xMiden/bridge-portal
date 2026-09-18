# Bridge portal runbook

## Live testnet E2E is red

1. Open the failed `e2e-testnet` run and the Playwright trace artifact.
2. Distinguish:
   - Empty faucet / below 0.001 Sepolia ETH: top up the throwaway key.
   - `E2E_MIDEN_ACCOUNT_FILE` missing: Send specs skip; add the hex-encoded exported account file secret.
   - Kernel skew (`procedure with root digest`): SDK pin is behind the testnet node. Bump `@miden-sdk/miden-sdk`.
   - Allocator 5xx / Epoch quote empty: Epoch testnet is down. Do not "fix" the portal.
   - Activity hash is a UUID: Midenscan link bug; `waitForTransaction` did not return `txHash`.

## Production looks down

`GET /health` is liveness only. Hit `https://bridge.miden.xyz/health` first, then check Cloudflare Worker logs. Deep health (Sepolia + Miden + Epoch + AggLayer) is a follow-up.

## Secrets

Repo Actions secrets (throwaway testnet only):

- `E2E_EVM_PRIVATE_KEY`
- `E2E_MIDEN_SEED`
- `E2E_MIDEN_ACCOUNT_ID`
- `E2E_MIDEN_ACCOUNT_FILE` (Send specs)
- `E2E_SEPOLIA_RPC_URL` (optional keyed RPC)

Never set these as `NEXT_PUBLIC_*` in a production `cf:deploy`.
