# Miden Bridge Portal

Next.js app for the wallet-native Miden bridge transfer flow — the wallet-facing
cross-chain Receive/Send surface.

The app serves both networks at `/`. The network selector remembers the choice
for the current tab and resets the transfer form and Miden wallet session. New
tabs default to mainnet. Mainnet supports Agglayer ETH and Circle USDCx; testnet
also retains Epoch routes. `/activity/:id` receipts automatically use their saved
network, including existing testnet transfers.

## Product model

See [docs/product-requirements.md](docs/product-requirements.md). Miden wallet
integration notes live in
[docs/miden-frontend-integration.md](docs/miden-frontend-integration.md).

Architecture decisions are recorded under [docs/decisions/](docs/decisions/) —
e.g. [why we ship single-thread WASM without cross-origin isolation
(no COOP/COEP)](docs/decisions/wasm-threading-coop-coep.md).

## Prerequisites

For local testnet transfers you need:

- **A Miden testnet wallet** — the MidenFi extension (or the Bread wallet). It
  supplies the Miden testnet account and signs the Miden-side transactions. Its
  connected account is used automatically as the Receive destination. Both
  wallets must be connected; recipient addresses cannot be entered manually.
- **Miden testnet funds** — from the Miden faucet at
  `https://faucet.testnet.miden.io`.
- **Sepolia funds** — an EVM wallet (WalletConnect or a `window.ethereum`
  extension) holding Sepolia ETH from any public Sepolia faucet, for the
  AggLayer deposit leg.
- **Node 22+** and npm.

## Local development

```bash
cp .env.example .env.local   # optional — every var has an in-code fallback
npm install
npm run dev
```

The dev server defaults to `http://localhost:3000/`. `GET /health` is liveness;
`GET /health/deep` checks Sepolia, Miden RPC, Epoch, and AggLayer.

The `/api/bridge/*` proxy defaults to `http://127.0.0.1:8080` for host
development; override with `BRIDGE_API_BASE`.

Ethereum wallet connection uses WalletConnect when
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set at build time. Leave it empty for
local extension testing through `window.ethereum`.

### Environment variables

All variables and their defaults are documented in
[`.env.example`](.env.example); the E2E harness knobs live in
[`.env.e2e.example`](.env.e2e.example). Every var has an in-code fallback, so
the app boots with none of them set. In brief:

| Var | Scope | Purpose |
| --- | --- | --- |
| `BRIDGE_API_BASE` | server | Proxy target for `/api/bridge/*`. |
| `ETHEREUM_RPC_URL` | server | Ethereum mainnet RPC. |
| `ARC_MAINNET_RPC_URL` | server | Arc mainnet RPC. |
| `BASE_RPC_URL` | server | Base mainnet RPC. |
| `ARBITRUM_RPC_URL` | server | Arbitrum mainnet RPC. |
| `AGGLAYER_SEPOLIA_RPC_URL` | server | Sepolia RPC. |
| `EVM_RPC_URL` | server | Secondary Sepolia RPC fallback. |
| `ARC_TESTNET_RPC_URL` | server | Arc Testnet RPC. |
| `BASE_SEPOLIA_RPC_URL` | server | Base Sepolia RPC. |
| `ARBITRUM_SEPOLIA_RPC_URL` | server | Arbitrum Sepolia RPC. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | client | WalletConnect / Reown project id. |
| `NEXT_PUBLIC_SEPOLIA_RPC_URL` | build | Public Sepolia fallback for the shared server RPC layer. |
| `NEXT_PUBLIC_ARC_RPC_URL` | build | Primary Arc Testnet RPC, with public fallbacks. |
| `NEXT_PUBLIC_MIDEN_RPC_URL` | client | Miden testnet RPC for the client Miden SDK. |
| `NEXT_PUBLIC_EPOCH_ALLOCATOR_URL` | client | Epoch Protocol allocator API base. |
| `NEXT_PUBLIC_APP_URL` | client | App origin used for wallet metadata during SSR. |

`NEXT_PUBLIC_*` vars are inlined into the client bundle at **build time** — set
them before `npm run build` / the Docker or Cloudflare build, not just at
runtime.

## Network configuration and upgrades

Both environments reuse [0xMiden/wallet-config](https://github.com/0xMiden/wallet-config).
Each release bundles one generated file per network:
`src/config/wallet-config/testnet.json` and `mainnet.json`. Each file records its
upstream commit and the validated configuration, including derived token metadata.
The browser and server use these same files synchronously. There is no runtime
wallet-config fetch, registry discovery, configuration cache or hot reload.

Token pairs live in the portal-owned
`src/config/wallet-config/token-connections.json`, beside those pinned files.
Each connection records its provider, EVM token, Miden faucet, both precisions,
local token-logo paths, and stable receive/send route IDs. Logos are bundled in
`public/asset-logos/`, with attribution in `SOURCES.md`. The registry is the source
for route assets and the asset exports used by faucet actions. There is no runtime
or build dependency on `token-list`.
Bridge contracts, provider endpoints, and availability switches continue to
come from the existing wallet-config documents. An absent direction is not
implemented; `disabled` keeps retired connections addressable.

To update the pin, use Node 22.18 or later and an explicit upstream commit:

```sh
npm run config:update -- <40-character-wallet-config-commit-sha>
npm run check:config
```

The update command fetches both documents at that immutable revision, validates
networks and approved services, and resolves the Miden bridge registry and Arc
xReserve registry. Every configured mainnet Agglayer token must have a local
connection and pass Ethereum/Miden ownership, faucet, and precision checks.
The importer rejects a missing or mismatched connection instead of silently
filtering tokens through a second allowlist. Source and destination precision
are independent: for example, NEAR uses 24 decimals on Ethereum and 8 on Miden.
`ETHEREUM_RPC_URL` can override the public Ethereum RPC used by the command.
Both networks must validate before the existing files are replaced. Review the
generated diff and run the checks before shipping it. Additional Epoch test
tokens and their verified mappings remain in the local connections file.
When changing token mappings, edit that file and rerun the import with the
selected wallet-config revision; normal builds check it against the generated
deployment metadata offline. Existing testnet/mainnet configuration files and
their upstream revision are retained.

Normal builds validate the checked-in files offline; they never fetch the latest
GitHub branch or regenerate metadata. Updating contracts, supported tokens or
route-disable switches requires a new portal deployment. Upstream wallet-config
changes do not automatically alter a running portal.

Each transfer saves its original assets and validated bridge configuration in
its receipt. Recovery uses that context after a deployment changes or removes a
route; historical deployments are not accumulated in the bundle. The activity
key is `miden.bridge.ui.activities.v2`; earlier transfers are intentionally not
migrated. Status APIs accept bounded recovery payloads and validate network,
chain, domain and approved service roots. New Circle quote/validation requests
must match the server's bundled configuration and an enabled direction; a stale
client is asked to reload and review again. On-chain preflight checks still run
before submission.

RPC and explorer URLs live in the local network registry. ERC-20 deposits use
exact-amount approvals, including a zero reset when required by USDT. Amounts
must fit the verified destination precision. `npm run check:pin-drift` compares
the pinned documents against wallet-config and the SDK version against the wallet.
This advisory check reports changes; it does not update files.

Route IDs remain stable across releases, preserving saved token selections.
Configuration stays fixed for the lifetime of the page. Provider and direction
preferences are separate per environment. Network choice uses
session storage and can differ across tabs. EVM submission checks the required
chain and account; every new submission checks the reviewed config, including
transfers without fee quotes. Quotes also bind the route, amount and recipients.

Bridge-in deposits are capped at a projected connected-account balance of
**$1,232.462**. The portal sums wallet holdings with available prices using trusted
faucet identities, then adds the gross deposit value before fees. Unknown or
unpriced holdings are excluded from the total and do not block deposits.
Comparisons preserve token and price decimal precision. Unavailable balances or
a missing/stale price for the deposit itself show an error with an explicit retry.
The cap notice appears only when the amount exceeds the limit.
Confirmation refreshes the account balance and prices
before any provider submission. This is a frontend safeguard, applied on both
network selections (testnet uses equivalent market estimates); withdrawals and
incoming note consumption are unrestricted by this cap. Pending deposits are
not reserved against the allowance until they appear in the wallet balance.

Bread must support the selected network. The installed adapter forwards the
`mainnet` connection string even though its published enum omits it; network
prefix checks reject wrong-network accounts before signing. Mainnet requires an
`mm1…` address; raw account IDs remain supported only for legacy testnet callers.
Use a mainnet-capable Bread release for manual end-to-end validation. The automated
suite uses mock signatures and does not transfer mainnet funds.

`GET /health/deep` remains the legacy testnet upstream check; it does not attest
to mainnet availability. Network-specific quote/status endpoints validate the
selected deployment independently.

## Build toolchain notes

A few non-obvious choices are load-bearing; don't "fix" them without checking
here first.

### Webpack, not Turbopack

`dev` and `build` are pinned to `next … --webpack` (see `package.json`).
Turbopack OOMs on the Miden SDK's eager WASM instantiation — the `@miden-sdk`
glue pulls the WASM in at module-eval time, and Turbopack's bundling of it
exhausts memory. Webpack handles it. Keep the `--webpack` flag.

### No cross-origin isolation (no COOP/COEP)

`next.config.ts` intentionally does **not** set COOP/COEP/CORP headers. This is
a deliberate tradeoff:

- `Cross-Origin-Opener-Policy: same-origin` breaks wallet connectors that rely
  on popups with `window.opener` (the Coinbase Wallet SDK throws without it).
- Under COEP the Miden note transport (gRPC-Web) can fail to sync
  (`MissingContentTypeHeader`).

The cost is that we can't use threaded (multi-threaded WASM) Miden builds, which
need `crossOriginIsolated`. Re-introduce isolation only if threaded WASM is
required *and* every wallet/transport dependency tolerates it.

### wasm-bindgen `exportsPresence` webpack shim

`next.config.ts` adds a webpack rule that sets `parser.exportsPresence = false`
for `node_modules/@miden-sdk/**`. The SDK's wasm-bindgen glue re-exports its
classes (`NoteArray`, `ForeignAccountArray`, …) through a rollup CJS-interop
file that webpack's static analysis can't follow, so it errors "X is not
exported" even though the exports exist at runtime. Downgrading the
export-presence check lets the build proceed; the named exports resolve
correctly at runtime via webpack's CJS interop.

### `@miden-sdk` pin

`package.json` pins `@miden-sdk/miden-sdk`, `@miden-sdk/react`, and both wallet
adapters to `0.17.6`. The core SDK pin is mirrored in `overrides` so React and
the wallet adapters resolve to one SDK instance. The `st`
wasm is ~20 MiB, under Cloudflare's 25 MiB
per-asset limit. `npm run check:wasm-size` fails the PR if that regresses.
`npm run check:usdcx-note` checks the pinned browser WASM against the preserved
Rust `0.17.1` note-ID reference so upgrades keep recognizing existing deposits.

## Validation

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm run check:config     # generated network configs validate offline
npm run check:wasm-size  # st wasm under 24 MiB
npm run test             # vitest run
npm run build            # next build --webpack
```

### End-to-end (Playwright)

```bash
npm run playwright:install     # one-time: chromium + deps
npm run test:e2e:mock          # mock tier: no secrets, network stubbed
npm run test:e2e:testnet       # live Sepolia + Miden; needs .env.e2e
```

CI runs that suite on `main` / `workflow_dispatch` (serialized, one funded key).
It skips cleanly until the `E2E_*` repo secrets exist. See `docs/runbook.md`.

## Docker

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<project-id> \
docker build -t bridge-portal .
docker run -p 3000:3000 bridge-portal
```

## Cloudflare deploy

Production runs on Cloudflare Workers via `@opennextjs/cloudflare` (see
`open-next.config.ts` and `wrangler.jsonc`; served at `bridge.miden.xyz`).

```bash
npm run cf:build     # next build --webpack + opennextjs-cloudflare build
npm run cf:preview   # cf:build, then run the Worker locally
npm run cf:deploy    # cf:build, then deploy to Cloudflare
```

`NEXT_PUBLIC_*` vars must be present at `cf:build` time to be inlined into the
client bundle.

## AggLayer testnet path

See [docs/agglayer-testnet.md](docs/agglayer-testnet.md) for the current Sepolia to
Miden testnet integration boundary.

### EVM reads and bridge providers

All supported origins (Ethereum, Arc, Base, Arbitrum and their testnets)
use `/api/evm/[network]/{balance,rpc,gas,transaction}`. The shared network registry
selects the chain; the server RPC layer owns upstream configuration, timeouts
and fallbacks. Balance responses use `balanceRaw` and `balance` for both native
and ERC-20 assets. RPC accepts only public reads and simulations; signing and
broadcasting stay with the connected wallet.

Bridge-specific operations stay under their provider: `/api/xreserve/quote`
obtains a Circle forwarding quote, `/api/xreserve/quote/validate` checks its
signature, burn parameters and expiry against the source-chain tip, and
`/api/xreserve/status?network=…&hash=…`
tracks direct Arc or CCTP deposits into Miden, and `/api/agglayer/deposits`
reads Agglayer deposits. Browser transports never import private RPC configuration.
