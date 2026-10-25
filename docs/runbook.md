# Bridge portal runbook

## Browser tests are red

1. Open the failed `mock` job in the `ci` workflow and download its Playwright trace artifact.
2. Reproduce with `npm run test:browser`; the browser tests run the normal application with simulated extension transports and remote responses without private keys, seeds, or funded accounts.
3. Inspect the failing assertion, screenshot, and trace for the affected wallet, navigation, review, or receipt flow.

Production deployment runs after successful `ci` on `main`, using the exact tested commit. A failed unit, browser, Cloudflare build, or Docker job blocks deployment.

## Production looks down

1. `GET https://bridge.miden.xyz/health` - process is up.
2. `GET https://bridge.miden.xyz/health/deep` - Sepolia, Miden RPC, Epoch allocator, AggLayer indexer. 503 names the failed check.
3. The `health` workflow hits `/health/deep` every 20 minutes.

## Pin drift

Nightly `pin-drift` compares portal `@miden-sdk/miden-sdk`, `MIDEN_BRIDGE_ID`, and `MIDEN_AGGLAYER_FAUCET_ID` to `0xMiden/wallet` main. A mismatch fails the workflow and opens/comments an issue. Do not auto-bump; wasm size and the adapter API need a reviewed PR.

## Secrets

Production deploy:

- `CLOUDFLARE_API_TOKEN`
- Eight primary EVM RPC URL secrets from [`.env.example`](../.env.example) (Worker runtime)
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (inlined at `cf:build`)

## Manual testnet check before a release

CI does not prove that a live transfer settles. For each affected enabled testnet
route and direction, a developer should:

1. Open the release candidate, choose Testnet and connect their own testnet wallets.
2. Review the source chain, token, amount, recipient and fee. Submit a small amount
   above the route minimum, and check the actual wallet prompt against that review.
3. Record the source transaction and receipt URL. Reload the receipt and verify
   that tracking resumes without requesting another signature.
4. Verify destination delivery against the destination explorer and receiving
   wallet (including note consumption when required). Record the received amount,
   fees, both transaction IDs, candidate commit and date in the release evidence.
5. Record unavailable quotes, RPC failures or unsettled transfers as incomplete
   checks. A source transaction alone is not evidence of destination settlement.

Wallet credentials stay in the developer's wallet. No seed or private-key CI
configuration is required. The `mock` CI job retains its historical required-check
name; its step and npm command describe browser integration coverage.
