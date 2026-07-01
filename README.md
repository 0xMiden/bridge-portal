# Miden Bridge Portal

Next.js app for the wallet-native Miden bridge transfer flow — the wallet-facing
cross-chain Receive/Send surface.

The current app is a frontend prototype with local mock quote and activity state
plus live testnet slices for bridge route development. It models Cross-chain
Receive, Cross-chain Send, route selection, claim, and stuck-funds recovery
before every route is wired to backend state.

## Product model

See [docs/product-requirements.md](docs/product-requirements.md). Miden wallet
integration notes live in
[docs/miden-frontend-integration.md](docs/miden-frontend-integration.md).

## Local development

Install dependencies and copy the example environment file:

```bash
npm install
cp .env.example .env.local
```

Start the dev server through the package script:

```bash
npm run dev
```

The script runs `next dev --webpack`. Use webpack for local development and
builds; Turbopack can run out of memory with the Miden WASM packages.

The dev server defaults to `http://localhost:3000/`, with a health check at
`/health`.

## Environment variables

All variables have in-code fallbacks, so the app can boot with an empty
`.env.local`. Set them explicitly when testing real wallet, RPC, or allocator
flows:

| Variable | Purpose |
| --- | --- |
| `BRIDGE_API_BASE` | Server-side proxy target for `/api/bridge/*`; defaults to `http://127.0.0.1:8080`. |
| `AGGLAYER_SEPOLIA_RPC_URL` | Sepolia RPC used by `/api/sepolia/transaction`; set your own endpoint for reliability. |
| `EVM_RPC_URL` | Optional EVM RPC override for EVM-side calls. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect project ID for Ethereum wallet connection. Leave empty for local extension testing through `window.ethereum`. |
| `NEXT_PUBLIC_EPOCH_ALLOCATOR_URL` | Epoch Protocol allocator API base; defaults to the testnet allocator. |
| `NEXT_PUBLIC_MIDEN_RPC_URL` | Miden testnet RPC used for Miden chain-head lookups; defaults to `https://rpc.testnet.miden.io`. |

## Testnet setup

For local end-to-end testing, use:

- MidenFi browser extension for Miden wallet connection.
- Miden testnet faucet: `https://faucet.testnet.miden.io`.
- A Sepolia faucet for test ETH when exercising EVM-side bridge flows.

## Browser and Next.js notes

Do not add cross-origin isolation headers (`Cross-Origin-Opener-Policy`,
`Cross-Origin-Embedder-Policy`, or `Cross-Origin-Resource-Policy`) for this app.
COOP/COEP breaks wallet connectors that rely on popups and can also break the
Miden gRPC-web transport. See the comment in `next.config.ts` before changing
headers.

The Next.js webpack config also contains an `exportsPresence` workaround for the
Miden SDK v0.15 wasm-bindgen output. Keep local dev and production builds on the
package scripts so that workaround is applied consistently.

## Validation

```bash
npm run typecheck
npm run lint
npm run build
```

`npm run build` also uses webpack. For Cloudflare, use:

```bash
npm run cf:preview
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
