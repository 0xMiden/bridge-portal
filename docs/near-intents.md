# NEAR Intents outbound rollout

The provider supports the 13 Miden → EVM pairs in `src/config/near/v1.json`.
Version 1 pins network, faucet/contract, decimals and 1Click asset ID. A catalog
refresh never changes the offered routes. Arc and EVM → Miden are excluded.
Base wBTC pays **cbBTC**; Arbitrum USDT pays **USDT0**.

The rollout is **off by default**. Existing providers keep their routes.

## Configuration

- `NEAR_API_KEY`: server-only 1Click partner credential. Configure it as a
  Cloudflare secret; never put it in a public environment variable or receipt.
- `NEXT_PUBLIC_NEAR_ENABLED=true`: exposes the pinned routes at build time.
- `NEAR_TRANSFERS_ENABLED=true`: permits executable quotes and the final server
  preflight at runtime. Set it to `false` to pause new transfers without stopping
  receipt tracking or optional deposit notifications.

For staging, set both switches explicitly. Do not enable production until the
funded release checks below pass. Quotes require no embedded NEAR account or
signed-intent submission in this implementation.

## Request and execution lifecycle

`POST /api/near/quote` validates the allowlisted route, `mode: "send"`, decimal
amount, mainnet refund account and EVM recipient. It requests a dry EXACT_INPUT
quote with ORIGIN_CHAIN funding, DESTINATION_CHAIN delivery and
`confidentiality: "basic"`. Amounts are integer source units (8 decimals for
ETH/wBTC, 6 for USDT/USDCx). There is no fixed $5 minimum.

Opening review calls `POST /api/near/prepare` once with the same input. The
executable quote supplies the actual output, minimum output, estimated time,
deposit address and optional memo. Both browser and server verify the official
1Click signature using SDK **0.1.26**. The review binds amount, route, recipient
and refund account. Changing a wallet or amount, or reaching expiry, requires a
new review. Confirmation calls `/prepare` with the signed quote to revalidate it
and the runtime pause switch; this does **not** allocate a second quote/address.

Funding uses the Miden SDK's standard **public P2ID** note and recipient discovery
tag. The NEAR team's November 6 instruction requires public deposits; Bread's
existing 1Click integration also uses a public send. This is not an Epoch
collateral note. Only basic-wallet Miden addresses and the standard discovery tag
are accepted. Any nonempty deposit memo, attachment or alternate deposit mode is
rejected before signing. Supporting additional instructions needs a separate
validated implementation.

The adapter refreshes source and USDCx fee balances before signing. It reserves
30 times the live Miden verification base fee, matching the portal's conservative
fee estimate. It constructs the exact faucet/amount output and persists a receipt
with its expected note ID before calling the wallet. A deterministic quote ID and
browser Web Lock prevent the same quote being funded twice. Durable storage is
mandatory: a failed write stops the wallet prompt.

The attempted state is saved before the wallet call. Request ID and actual
transaction hash are saved as they arrive. A lost wallet response remains an
ambiguous pending operation; reopening its receipt resumes status checks and
never automatically funds it again. Explicitly check Bread/support if a request
was rejected or interrupted before a transaction hash was returned.

`POST /api/near/deposit/submit` optionally accelerates deposit detection. Its
failure only schedules a notification retry. `POST /api/near/status` checks the
original signed quote and address/memo identity even after expiry. Receipts keep
their route/config snapshot, complete signed quote and source/destination hashes.
All upstream requests have fixed URLs, reject redirects, use bounded timeouts and
bodies, and bypass caching. Errors contain a safe correlation ID, never a raw
upstream error or credential.

Tracking handles PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, INCOMPLETE_DEPOSIT, PROCESSING,
SUCCESS, REFUNDED and FAILED. Refunds have their own terminal state and amount;
they never appear as EVM delivery. Outages leave progress pending with retry
guidance. Late polls cannot erase accepted funding evidence or undo terminal
outcomes. No UI action tops up incomplete deposits automatically.

The live status API omits the nested quote's `correlationId` and
`quoteWaitingTimeMs`, and returns `refundReason: null` when there is no refund.
The server restores only the omitted metadata from the already verified receipt
and verifies the returned quote's full signature and deposit identity again.
The response sent to the browser contains the verifiable quote and normalizes a
null refund reason to absence. Returned transfer terms are never overwritten.

## Validation and remaining release dependency

The supplied November 6 evidence had 13 successful dry `basic` quotes. The fresh
unauthenticated recheck is recorded in
[`near-dry-validation-2026-11-06.json`](near-dry-validation-2026-11-06.json): all
13 returned **HTTP 401**. A non-dry request also returned HTTP 401 with
“User authentication is required for confidential intent quotes.” No
`NEAR_API_KEY` was configured in the development environment.

A partner credential was subsequently configured locally. A user-initiated
Miden ETH → Ethereum ETH transfer completed successfully with this direct `basic`
flow: NEAR returned SUCCESS and the Ethereum transaction receipt confirmed
execution. The original portal receipt now shows delivery and both transaction
hashes after fixing the status response differences described above. No additional
deposit was sent during diagnosis. The remaining routes, refund recovery and
pause behavior still need the funded release checks below. The team's
RDA/ANY_INPUT/confidential-account flow is separate and is not implemented here.

Repeat the live validation with the approved server credential:

```sh
npm run check:near-quotes -- --recipient 0x… --refund mm1… --output near-validation.json
```

The script checks live catalog identities and verifies quote signatures for the
13 pinned routes using approximately $5 samples. It never funds a transfer.

Before enabling production:

1. Repeat authenticated quote validation across all pinned routes. The completed
   ETH → Ethereum transfer confirms authorization and public P2ID discovery for
   that route; confirm the remaining assets' deposit requirements with G-20.
2. On staging, perform controlled funded transfers covering every source and
   destination network. One covering set is ETH → Robinhood, wBTC → Base,
   USDT → Arbitrum, USDCx → Polygon and USDCx → Ethereum. Record quote references,
   Miden note/request/transaction IDs, EVM delivery hashes and actual amounts.
3. Verify reload after wallet acceptance, delayed notification/status responses,
   refund recovery and the pause switch with real receipts. Do not infer refunds
   or settlement solely from a dry quote.
4. Run `npm run check:config`, `npm run typecheck`, `npm run lint`, `npm test`,
   relevant browser tests and `npm run cf:build` before enabling the switches.

Automated tests use the official verifier on a captured live dry quote, an
ephemeral test service signing key for prepared/status responses, the actual
browser Miden WASM, extension responses, and durable browser-storage boundaries.
They do not prove live settlement. The subsequent user-initiated transfer above
provides live settlement evidence for ETH → Ethereum only.

Validation on November 6, 2026:

| Check | Result |
| --- | --- |
| Configuration, TypeScript and lint | Passed |
| Vitest | 887 passed, including 34 NEAR cases |
| Browser review/cancellation regressions | 4 passed |
| Browser receipt/tracking regressions | 10 passed |
| Cloudflare production build | Passed; dependency/toolchain warnings remain |
| Production-server request checks | Reverse quote rejected with 400; paused preparation rejected with 503; both uncached |
| Live catalog and 13 dry quotes | All pinned identities matched the catalog; all quotes returned 401 without credentials |
| Funded execution | Subsequent user-initiated ETH → Ethereum transfer confirmed; remaining release checks are outstanding |

References: [1Click signatures](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature),
[SDK](https://docs.near-intents.org/integration/distribution-channels/1click-api/sdk),
[status](https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status),
[deposit notification](https://docs.near-intents.org/api-reference/oneclick/submit-deposit-transaction-hash).
