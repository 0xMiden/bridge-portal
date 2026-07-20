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

## Local development

```bash
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

## Validation

```bash
npm run typecheck
npm run lint
npm run build
```

## Docker

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<project-id> \
docker build -t bridge-portal .
docker run -p 3000:3000 bridge-portal
```

## AggLayer testnet path

See [docs/agglayer-bali.md](docs/agglayer-bali.md) for the current Sepolia to
Miden testnet integration boundary.
