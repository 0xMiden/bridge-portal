# Miden Bridge Portal

Next.js app for the wallet-native Miden bridge transfer flow — the wallet-facing
cross-chain Receive/Send surface.

The app serves both networks at `/`. The network selector remembers the choice
for the current tab and resets the transfer form and Miden wallet session. New
tabs default to testnet. Mainnet supports Agglayer ETH and Circle USDCx; testnet
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
| `AGGLAYER_SEPOLIA_RPC_URL` | server | Primary Sepolia RPC for shared EVM reads and provider tracking. |
| `EVM_RPC_URL` | server | Secondary Sepolia RPC fallback. |
| `BASE_SEPOLIA_RPC_URL` | server | Optional primary Base Sepolia RPC, with Base and PublicNode fallbacks. |
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
Reviewed snapshots live in `src/config/wallet-config/snapshots.json`; the browser
never downloads mutable configuration at runtime. Contracts, Circle domains and
services, Epoch outputs, and provider direction switches come from that repo.
The import script resolves missing ETH faucet/precision and rollup information
from the Miden bridge registry, and the USDCx faucet from Arc's xReserve contract.
Mainnet USDT, WBTC, PYUSD and WSOL metadata is verified against Ethereum and the
Miden registry, including faucet ownership and destination precision, then saved
in the same snapshot. These tokens support Ethereum → Miden deposits through
Agglayer. Native ETH uses the zero token address and retains both directions.
ERC-20 deposits use zero ETH value, exact-amount approvals when needed, and a
confirmed zero reset for existing insufficient allowances (including USDT).
Amounts must fit the destination precision: 6 decimals for USDT/PYUSD and 8 for
WBTC/WSOL/ETH. Ethereum's WSOL contract reports symbol `SOL` and 9 decimals;
the portal displays `WSOL` and rejects nonzero ninth-decimal amounts.
RPC and explorer URLs live in the local network registry.

To import a reviewed upstream revision:

```bash
npm run sync:wallet-config -- <full-40-character-commit-sha>
npm run typecheck
npm test
npm run build
```

Review the resulting JSON diff before deployment. The importer requires both
networks to validate and keeps earlier snapshots. **Do not delete or reorder old
snapshots**: legacy transfers resolve to the first testnet deployment; new
receipts save their route, assets, and deployment ID. New transfers use the last
snapshot for their environment. API calls accept only bundled deployment IDs;
old calls without one still target the original testnet deployment. A rollback
of active configuration should be deliberate and preserve all receipt snapshots.
The additional verified Epoch test tokens remain portal-owned; canonical Epoch
USDC and availability follow wallet-config.

Activity storage retains the existing JSON array and key, with history filtered
by the selected network. Reading old history adds testnet metadata in memory; the
original data is kept until an activity is saved. Route and direction preferences
are separate per environment. Network choice uses session storage, survives
reloads, and can differ across tabs without adding a network prefix to URLs. Switching clears amount, quote, review, and
Miden balances; EVM submission checks the required chain and account. Quotes
are bound to their deployment as well as route, amount, and recipients.

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

`package.json` pins `@miden-sdk/miden-sdk` and `@miden-sdk/react` to `0.17.4`,
matching the wallet. The core SDK pin is mirrored in `overrides` so React and
the compatible `0.17.0` wallet adapters resolve to one SDK instance. The `st`
wasm is ~20 MiB, under Cloudflare's 25 MiB
per-asset limit. `npm run check:wasm-size` fails the PR if that regresses.
`npm run check:usdcx-note` checks the pinned browser WASM against the preserved
Rust `0.17.1` note-ID reference so upgrades keep recognizing existing deposits.

## Validation

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
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
obtains a Circle forwarding quote, `/api/xreserve/status?network=…&hash=…`
tracks direct Arc or CCTP deposits into Miden, and `/api/agglayer/deposits`
reads Agglayer deposits. Browser transports never import private RPC configuration.
