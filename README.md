# Miden Bridge Portal

Next.js app for the wallet-native Miden bridge transfer flow — the wallet-facing
cross-chain Receive/Send surface.

The app serves both networks at `/`. The network selector remembers the choice
for the current tab and resets the transfer form and Miden wallet session. New
tabs default to mainnet. Mainnet supports Agglayer, Circle USDCx, and Epoch routes;
testnet also retains these providers. `/activity/:id` receipts automatically use their saved
network, including existing testnet transfers.

## Product model

See [docs/product-requirements.md](docs/product-requirements.md). Miden wallet
integration notes live in
[docs/miden-frontend-integration.md](docs/miden-frontend-integration.md).

Architecture decisions are recorded under [docs/decisions/](docs/decisions/) —
e.g. [why we ship single-thread WASM without cross-origin isolation
(no COOP/COEP)](docs/decisions/wasm-threading-coop-coep.md).

## Prerequisites

Use **Node 22.18.0** (also pinned in `.nvmrc`) and npm. Source wallets need
native gas and the asset for their selected route: Phantom with Devnet SOL and
native USDC for Solana, or an EVM wallet with the corresponding network funds.
A connected Miden wallet supplies the Receive destination from its selected
account. Claiming an included note is a separate wallet action. Incoming USDCx
can cover claim fees when the wallet/protocol permits and the amount suffices;
check the current fee rather than universally requiring a prefunded recipient.

## Local development

```bash
git clone --branch feat/cctp-all-sources https://github.com/0xMiden/bridge-portal.git
cd bridge-portal
node --version  # v22.18.0
cp .env.example .env.local
npm ci
npm run dev
```

For the production Node server, configure `.env.local`, then use:

```bash
npm run build
npm run start
```

Restart `npm run start` with the same server inputs. Public `NEXT_PUBLIC_*`
changes require rebuilding. Keep private provider inputs out of browser values.

The dev server defaults to `http://localhost:3000/`. `GET /health` is liveness;
`GET /health/deep` checks Sepolia, Miden RPC, Epoch, and AggLayer.

The `/api/bridge/*` proxy defaults to `http://127.0.0.1:8080` for host
development; override with `BRIDGE_API_BASE`.

Ethereum wallet connection uses WalletConnect when
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set at build time. Leave it empty for
local extension testing through `window.ethereum`.

### Environment variables

All variables and their defaults are documented in
[`.env.example`](.env.example). The app boots without overrides; helper routes
fail closed until qualified public identities and server providers are available.
Browser tests configure their mock wallets
automatically and require no wallet credentials. In brief:

| Var | Scope | Purpose |
| --- | --- | --- |
| `BRIDGE_API_BASE` | server | Proxy target for `/api/bridge/*`. |
| `CCTP_HELPER_SERVERS_JSON` | server | Private Solana helper provider rows, replacing the tracked server registry. |
| `CCTP_EVM_HELPER_SERVERS_JSON` | server | Private EVM helper provider rows, replacing the tracked server registry. |
| `ETHEREUM_RPC_URL` | server | Ethereum mainnet RPC. |
| `ARC_MAINNET_RPC_URL` | server | Arc mainnet RPC. |
| `BASE_RPC_URL` | server | Base mainnet RPC. |
| `ARBITRUM_RPC_URL` | server | Arbitrum mainnet RPC. |
| `POLYGON_RPC_URL` | server | Polygon mainnet RPC. |
| `ROBINHOOD_RPC_URL` | server | Robinhood mainnet RPC. |
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

## CCTP helper configuration and recovery

The qualified public helper registries and tracked server registries are currently
empty. This branch does not enable a helper route. A release owner must first earn
the five Solana qualification proofs and publish the matching public deployment;
private provider configuration alone cannot activate it. Unqualified sources and
mainnet helpers remain unavailable. Existing direct and Generic Executor routes
retain priority, and inactive EVM helper manual/export support remains intact.

For an accepted deployment, set `CCTP_HELPER_SERVERS_JSON` server-side to an array
with exactly one row for its trusted `deploymentId`. The following is a shape
example with unusable placeholders, not an activation profile:

```json
[
  {
    "deploymentId": "<qualified-release-id>",
    "solanaRpc": "https://<history-capable-solana-provider>",
    "arcRpc": "https://<finalized-arc-provider>",
    "irisApi": "https://iris-api-sandbox.circle.com",
    "simulationCaller": "<public-read-only-payer-address>"
  }
]
```

EVM rows use `CCTP_EVM_HELPER_SERVERS_JSON` and `sourceRpc` instead of
`solanaRpc`. A present variable replaces the entire corresponding tracked array;
empty, malformed, duplicate or incomplete configuration fails closed. Only an
absent variable uses tracked rows. URLs require HTTPS, except loopback HTTP for
local tests, and cannot contain username/password credentials. Circle must use
the official sandbox origin for testnet or `https://iris-api.circle.com` for
mainnet; this environment rule does not qualify a mainnet route. Providers must
retain the configured source boundary and support finalized Arc reads/logs.
`simulationCaller` is a public address for read-only simulation, never a key.

For local Node, edit these values in the ignored `.env.local`; do not shell-evaluate
that file. In Cloudflare, install these variables as runtime Worker secrets through
your deployment's secret-binding mechanism. The pinned OpenNext adapter exposes
string bindings to server `process.env` before request handling. No server
filesystem/config file is required. Do not put private URLs in public deployment
JSON, `NEXT_PUBLIC_*`, browser props or recovery exports. Missing or invalid
providers return `503 route_unavailable`; check these server variables and the
selected qualified deployment before retrying.

The ordinary Receive flow uses Phantom and the connected Miden Testnet account;
no Arc wallet is needed when the independent worker executes the helper call.
Activity retains authenticated progress through reloads. Its normal recovery
screen accepts the original Solana source signature; an optional Arc transaction
hash is only a locator that must pass full receipt verification. Recover the
original transfer instead of creating another burn. When offered, download the
verified call for a separately funded independent Arc payer to revalidate and
execute. Temporary provider/worker outages do not prove failure or permit a
replacement burn. Miden note inclusion means delivery; claim/consume in the
recipient wallet makes the funds available and is reported separately.

The incoming worker and existing downstream xReserve minter run independently of
the browser. For local testnet worker use without AWS login:

```bash
git clone --branch test/cctp-local-signer https://github.com/0xMiden/miden-usdcx.git miden-usdcx-local
```

Follow that branch's [worker instructions](https://github.com/0xMiden/miden-usdcx/blob/test/cctp-local-signer/README.md):
use its `config.local.example.json`, an operator-owned ignored `0600` dotenv file,
a fresh dedicated Arc Testnet gas payer, explicit finite caps, one initialization
and ordinary restarts with the same profile/key and intact SQLite journal. Never
source the dotenv file, pass a private key on the command line, reuse an unknown
sender history or delete a journal to retry. Production KMS support is separate
and remains available. The existing downstream minter's operator must confirm
current readiness; the frontend does not start or replace that service. Actual
Phantom, provider, worker and end-to-end claim qualification remain release gates.

The compiler-owned ABI is copied byte-for-byte to
`src/bridge/providers/xreserve/abi/MidenCctpDepositHelper.json` from backend commit
`1670643e29026ecd782e029d8b6b16ced576db37`, SHA256
`237b93bc9629d086e6408754b97e400c9a780de3568bd1976f99059949cd201a`.
The helper source SHA256 is
`82a77d61051fd6f8e18f7fc44a59e6ce060083eeb5eb8f79613f5039399e473f`.
The minimal TypeScript calls/getters/event are checked against this artifact;
regenerate it in the backend owner rather than editing the copy independently.

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
come from the existing wallet-config documents, with one explicit portal rollout
in `src/config/wallet-config/epoch-mainnet.ts`. It uses
`https://mainnet-api.epochprotocol.xyz` and enables both Epoch directions
independently of upstream's `fastBridge` flag for these pairs:

- USDC ↔ Miden USDCx on Ethereum, Base, Arbitrum and Polygon.
- Native ETH ↔ Miden ETH on Ethereum, Base, Arbitrum and Robinhood.
- Native POL ↔ Miden POL on Polygon.
- USDG ↔ Miden USDG on Robinhood.

The pinned upstream files and revision remain intact; release validation checks
the effective configuration and receipts save it. Faucets and token precisions
come from the verified Miden registry metadata. Native deposits send ETH/POL
directly to Compact without an ERC-20 approval, and retain deposit evidence for
recovery. Robinhood uses chain ID 4663. The allocator was confirmed via
[wallet-config PR #23](https://github.com/0xMiden/wallet-config/pull/23) and live
quotes in both directions on October 24, 2026. The portal adopted Epoch's current
API host on October 27; historical receipts retain their original service root.
Quotes depend on the entered amount and current liquidity: preview requires
a positive, unexpired matching quote,
and execution fetches and validates another quote before signing collateral.
Epoch intents SDK `2.2.0` and commons SDK `2.1.0` are pinned together.
The SDK now requires deployment addresses, lock/expiry settings, Miden recall
buffer and gasless configuration from the allocator's `/health` response.
Deposit recovery tracks the service-configured Compact address.
The portal explicitly disables gasless smart-account execution. A versioned
`patch-package` fix lets SDK 2.2.0 treat omitted gasless metadata as unavailable
capabilities in that mode, while keeping contract addresses and timing settings
mandatory. If token approval-reset policy is absent, a partial allowance is
reset to zero before approving the exact amount. `npm ci` applies the patch;
Webpack's build cache also tracks it. Review and remove it when an upstream
release supplies the same behavior.
Live quotes for all ten pairs succeeded in both directions on October 30, 2026.
This verifies quoting, not settlement.
The testnet API still lacks required deployment/timing fields and is rejected
before signing; restoring testnet requires a compatible Epoch API. The legacy
`NEXT_PUBLIC_EPOCH_ALLOCATOR_URL` override applies only to testnet.
`POLYGON_RPC_URL` and `ROBINHOOD_RPC_URL` optionally override their server-side read RPCs.

An absent direction is not
implemented; `disabled` keeps retired connections addressable.

To update the pin, use Node 22.18 or later and an explicit upstream commit:

```sh
npm run config:update -- <40-character-wallet-config-commit-sha>
npm run check:config
```

The update command fetches both documents at that immutable revision, validates
networks and approved services, and resolves the Miden bridge registry and Arc
xReserve registry. Every configured mainnet Agglayer token must have a local
connection. All local Agglayer connections, including additions beyond the pin,
pass EVM/Miden ownership, faucet, and precision checks on import.
The importer rejects a missing or mismatched connection instead of silently
filtering tokens through a second allowlist. Source and destination precision
are independent: for example, NEAR uses 24 decimals on Ethereum and 8 on Miden.
`ETHEREUM_RPC_URL` can override the public Ethereum RPC used by the command.
Both networks must validate before the existing files are replaced. Review the
generated diff and run the checks before shipping it. Additional Epoch test
tokens and their verified mappings remain in the local connections file.
`AGGLAYER_SEPOLIA_RPC_URL` overrides Sepolia's import-time RPC.
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
suite supplies extension responses and does not sign or transfer mainnet funds.

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
npm run check:usdcx-note # exact existing USDCx note identity
npm run test             # vitest run
npm run build            # next build --webpack
```

### Browser integration tests (Playwright)

```bash
npm run playwright:install     # one-time: chromium + deps
npm run test:browser           # production app; simulated external wallets and responses
node --test scripts/test-helper-browser-guards.test.mjs
npm run test:browser:helper    # isolated loopback-only helper fixtures
```

CI runs unit/type/lint/config/WASM/note checks, ordinary and isolated helper
browsers, Cloudflare and Docker builds on pull requests, manual dispatch and
pushes to `main` or `feat/cctp-all-sources`. Production
deployment follows successful CI on `main`. Playwright runs the ordinary production build with the real wallet providers.
Fixtures inject extension transports and intercept remote responses. Transaction
checks inspect calldata or deserialize Miden wallet requests using the shipped
browser WASM; simulated acceptance is supplied only after checking the request.
The browser runner supplies a placeholder public WalletConnect project ID and
intercepts wallet discovery responses. No private keys, seeds, funded accounts,
Reown account, or live signing are used.

The helper runner requires Node 22.18.0, replaces registries only in its owned
isolated copy and verifies that source registries and the dependency lock remain
unchanged. Its synthetic qualification flags never alter production registries.

Passing CI verifies UI, lifecycle, transaction construction and recovery under
controlled external responses. It does not verify live proving, broadcasting,
liquidity or settlement. Run the manual testnet release check in
[`docs/runbook.md`](docs/runbook.md) for that evidence.

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
