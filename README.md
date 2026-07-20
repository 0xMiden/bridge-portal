# Miden Bridge Portal

Next.js app for the wallet-native Miden bridge transfer flow — the wallet-facing
cross-chain Receive/Send surface.

The current app is a frontend prototype with local mock quote and activity state
plus a first AggLayer Sepolia-to-Miden testnet submit path. It models Cross-chain
Receive, Cross-chain Send, route selection, claim, and stuck-funds recovery
before every route is wired to backend state.

## Product model

See [docs/product-requirements.md](docs/product-requirements.md). Miden wallet
integration notes live in
[docs/miden-frontend-integration.md](docs/miden-frontend-integration.md).

Architecture decisions are recorded under [docs/decisions/](docs/decisions/) —
e.g. [why we ship single-thread WASM without cross-origin isolation
(no COOP/COEP)](docs/decisions/wasm-threading-coop-coep.md).

## Prerequisites

Testnet only. To exercise the live bridge path locally you need:

- **A Miden testnet wallet** — the MidenFi extension (or the Bread wallet). It
  supplies the Miden testnet account and signs the Miden-side transactions. Its
  bech32 address (or the 30-hex account ID) is what you paste as the Receive
  destination.
- **Miden testnet funds** — from the Miden faucet at
  `https://faucet.testnet.miden.io`.
- **Sepolia funds** — an EVM wallet (WalletConnect or a `window.ethereum`
  extension) holding Sepolia ETH from any public Sepolia faucet, for the
  AggLayer deposit leg.
- **Node 20+** and npm.

## Local development

```bash
cp .env.example .env.local   # optional — every var has an in-code fallback
npm install
npm run dev
```

The dev server defaults to `http://localhost:3000/`, with a health check at
`/health`.

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
| `AGGLAYER_SEPOLIA_RPC_URL` | server | Sepolia RPC for `/api/sepolia/transaction` (primary). |
| `EVM_RPC_URL` | server | Secondary Sepolia RPC fallback. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | client | WalletConnect / Reown project id. |
| `NEXT_PUBLIC_SEPOLIA_RPC_URL` | client | Sepolia RPC for wagmi/AppKit on-chain reads. |
| `NEXT_PUBLIC_MIDEN_RPC_URL` | client | Miden testnet RPC for the client Miden SDK. |
| `NEXT_PUBLIC_EPOCH_ALLOCATOR_URL` | client | Epoch Protocol allocator API base. |
| `NEXT_PUBLIC_APP_URL` | client | App origin used for wallet metadata during SSR. |

`NEXT_PUBLIC_*` vars are inlined into the client bundle at **build time** — set
them before `npm run build` / the Docker or Cloudflare build, not just at
runtime.

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

`package.json` pins `@miden-sdk/miden-sdk` to `0.15.7` (exact, mirrored in
`overrides` so `@miden-sdk/react` and the wallet adapters resolve to the same
single SDK instance). `0.15.7` is the first published release carrying the
B2AGG callback + web-sdk (#240) fixes, and its `st` wasm ships pre-stripped
(~17 MB), so it fits Cloudflare's 25 MiB per-asset limit without a local build.
This replaces the earlier temporary `vendor/` tarball pin.

## Validation

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest run
npm run build       # next build --webpack
```

### End-to-end (Playwright)

```bash
npm run playwright:install     # one-time: chromium + deps
npm run test:e2e:mock          # mock tier — no secrets, network stubbed
npm run test:e2e:testnet       # real-testnet tier — needs .env.e2e (see .env.e2e.example)
```

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

See [docs/agglayer-bali.md](docs/agglayer-bali.md) for the current Sepolia to
Miden testnet integration boundary.
