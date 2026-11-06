# NEAR Intents rollout

The provider supports the 13 pairs in `src/config/near/v1.json` in both directions:
Miden → EVM (Withdraw, `send`) and EVM → Miden (Deposit, `receive`): 26 routes.
Version 1 pins network, faucet/contract, decimals and 1Click asset ID. A catalog
refresh never changes the offered routes. Arc is excluded. The original outbound
IDs are unchanged; each pair has an explicit `receiveId` for its reverse route.

| EVM network | EVM assets ↔ Miden assets |
| --- | --- |
| Ethereum | ETH ↔ ETH, WBTC ↔ wBTC, USDT ↔ USDT, USDC ↔ USDCx |
| Base | ETH ↔ ETH, cbBTC ↔ wBTC, USDC ↔ USDCx |
| Arbitrum | ETH ↔ ETH, USDT0 ↔ USDT, USDC ↔ USDCx |
| Polygon | USDT ↔ USDT, USDC ↔ USDCx |
| Robinhood | ETH ↔ ETH |

The rollout is **off by default**. Existing providers keep their routes.

## Configuration

- `NEAR_API_KEY`: server-only 1Click partner credential. Configure it as a
  Cloudflare secret; never put it in a public environment variable or receipt.
- `NEXT_PUBLIC_NEAR_ENABLED=true`: exposes both directions at build time.
- `NEAR_TRANSFERS_ENABLED=true`: permits executable quotes and the final server
  preflight at runtime. Set it to `false` to pause new transfers without stopping
  receipt tracking or optional deposit notifications.

For staging, set both switches explicitly. Do not enable production until the
funded release checks below pass. Quotes require no embedded NEAR account or
signed-intent submission in this implementation.

## Request and execution lifecycle

`POST /api/near/quote` validates the allowlisted route, matching `send`/`receive`
mode, decimal amount, mainnet Miden account and EVM address. It requests a dry EXACT_INPUT
quote with ORIGIN_CHAIN funding, DESTINATION_CHAIN delivery and
`confidentiality: "basic"`. Amounts use source-chain units: Miden ETH has 8
decimals, EVM ETH has 18, BTC assets have 8, and stablecoins have 6. Output uses
destination precision. Receive binds the Miden recipient and EVM refund address;
Send binds the EVM recipient and Miden refund address. There is no fixed $5 minimum.

Opening review calls `POST /api/near/prepare` once with the same input. The
executable quote supplies the actual output, minimum output, estimated time,
deposit address and optional memo. Both browser and server verify the official
1Click signature using SDK **0.1.26**. The review binds amount, route, recipient
and refund account. Changing a wallet or amount, or reaching expiry, requires a
new review. Confirmation calls `/prepare` with the signed quote to revalidate it
and the runtime pause switch; this does **not** allocate a second quote/address.

### Miden-funded withdrawals

Send uses the Miden SDK's standard **public P2ID** note and recipient discovery
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

### EVM-funded deposits

Receive switches the EVM wallet to the selected source chain and rechecks the
account and chain immediately before signing. Native ETH sends the exact quoted
wei amount to the deposit address. ERC-20 deposits call `transfer` on the pinned
source token contract; they need no spender approval. The adapter checks fresh
token/native balances, simulates ERC-20 transfers, estimates gas with a 20% buffer,
and reserves source-chain gas separately from the quoted input.

The existing Miden balance cap remains mandatory. The final server preflight
checks the runtime pause switch and original signed quote without allocating a
new deposit address. Unsupported memos, attachments, deposit modes, wrong-chain
addresses, expired quotes and wallet changes stop funding. The receipt and
attempted state are stored before the single `eth_sendTransaction` call. Accepted
hashes are saved before optional deposit notification. There is no automatic
retry of a wallet submission whose response was lost.

While NEAR awaits the deposit, source-chain receipt checks distinguish pending,
confirmed and reverted transactions. Repriced hashes survive reload; cancellation
or replacement by a different transaction records a source failure. RPC outages
keep the receipt pending. Miden delivery and EVM refunds use their respective
asset precisions and explorer links.

### Shared recovery and tracking

The attempted state is saved before the wallet call. Request ID and actual
transaction hash are saved as they arrive. A lost wallet response remains an
ambiguous pending operation; reopening its receipt resumes status checks and
never automatically funds it again. Check the source wallet/support if a request
was rejected or interrupted before a transaction hash was returned.

`POST /api/near/deposit/submit` optionally accelerates deposit detection. Its
failure only schedules a notification retry. `POST /api/near/status` checks the
original signed quote and address/memo identity even after expiry. Receipts keep
their route/config snapshot, complete signed quote and source/destination hashes.
All upstream requests have fixed URLs, reject redirects, use bounded timeouts and
bodies, and bypass caching. Errors contain a safe correlation ID, never a raw
upstream error or credential. Quote requests allow 30 seconds upstream and 40
seconds in the browser: Polygon reverse quotes took about 20.5 seconds in live
validation. Status and notification timeouts remain 15/20 seconds.

Tracking handles PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, INCOMPLETE_DEPOSIT, PROCESSING,
SUCCESS, REFUNDED and FAILED. Refunds have their own terminal state and amount;
they never appear as destination delivery. Outages leave progress pending with retry
guidance. Late polls cannot erase accepted funding evidence or undo terminal
outcomes. No UI action tops up incomplete deposits automatically.

The live status API omits the nested quote's `correlationId` and
`quoteWaitingTimeMs`, returns `amountOut: null` while awaiting a deposit, and
returns `refundReason: null` when there is no refund.
The server restores only the omitted metadata from the already verified receipt
and verifies the returned quote's full signature and deposit identity again.
The response sent to the browser contains the verifiable quote and normalizes
unavailable output/refund reason to absence. Returned transfer terms are never
overwritten. Tracking reads status before retrying optional notifications, and
stops sending hints once NEAR has detected the deposit. A failed hint cannot
leave a retry warning on a delivered or refunded transfer.

## Live validation and remaining release checks

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
deposit was sent during diagnosis. The team's
RDA/ANY_INPUT/confidential-account flow is separate and is not implemented here.

Authenticated reverse validation is recorded in
[`near-inbound-dry-validation-2026-11-06.json`](near-inbound-dry-validation-2026-11-06.json).
All 13 EVM → Miden routes returned HTTP 201 with valid official signatures and
matching catalog identities. Local native ETH and Base USDC executable quotes,
same-quote preflight and unfunded PENDING_DEPOSIT status checks returned HTTP 200.

A subsequent user-initiated **Ethereum ETH → Miden ETH** deposit completed:
0.002 ETH funded on Ethereum and 0.00189499 ETH delivered on Miden. The portal
showed Complete and Bread showed the confirmed received transfer. Source:
`0x2fc0cd8e3ba976abc81f16501916e01275c34e7875739b83d71db8e96485149e`;
Miden delivery: `0xeba492472d11897505ca5408cbefe813de66bd92968f9fb1b46a9d8a11fc6fee`.
The observed delivery time was 2m 2s; the quote's time estimate is not a guarantee.
NEAR's optional `/deposit/submit` endpoint returned HTTP 500 during investigation,
but automatic detection and delivery succeeded. Pending status initially returned
502 from the portal because `amountOut: null` was rejected; normalization fixes it
without weakening quote verification.

Repeat the live validation with the approved server credential:

```sh
# Credentials already exported in the shell:
npm run check:near-quotes -- --direction send --recipient 0x… --refund mm1… --output near-outbound.json
npm run check:near-quotes -- --direction receive --recipient mm1… --refund 0x… --output near-inbound.json

# Alternatively, load the local server-only credential explicitly:
node --env-file=.env.local --experimental-strip-types scripts/check-near-quotes.mjs --direction receive --recipient mm1… --refund 0x… --output near-inbound.json
```

The script checks live catalog identities and verifies quote signatures for the
13 pinned pairs in the selected direction using approximately $5 samples. It
records individual failures without abandoning the remaining checks and never
funds a transfer.

Before enabling production:

1. Repeat authenticated quote validation across all pinned routes. The completed
   ETH → Ethereum transfer confirms authorization and public P2ID discovery for
   that route; confirm the remaining assets' deposit requirements with G-20.
2. On staging, perform controlled funded transfers covering every source and
   destination network in both directions, including native ETH and ERC-20
   deposits. Outbound examples are ETH → Robinhood, wBTC → Base, USDT → Arbitrum,
   USDCx → Polygon and USDCx → Ethereum. Reverse examples are Base cbBTC → wBTC,
   Arbitrum USDT0 → USDT, Polygon USDC → USDCx and Robinhood ETH → ETH. Record
   quote references, Miden note/request/transaction IDs, EVM hashes and amounts.
3. Verify reload after wallet acceptance, delayed notification/status responses,
   refund recovery and the pause switch with real receipts. Do not infer refunds
   or settlement solely from a dry quote.
4. Run `npm run check:config`, `npm run typecheck`, `npm run lint`, `npm test`,
   relevant browser tests and `npm run cf:build` before enabling the switches.

Automated tests use the official verifier on a captured live dry quote, an
ephemeral test service signing key for prepared/status responses, the actual
browser Miden WASM, EVM wallet/RPC responses, and durable browser-storage
boundaries. They cover exact native/ERC-20 funding, receipt persistence before
signing, lost wallet responses, balance/gas/cap checks, pause, account changes,
expiry, source replacements/reverts, Miden delivery and EVM refunds. They do not
prove live settlement. The two user-initiated transfers above provide settlement
evidence for ETH between Miden and Ethereum in both directions; funded coverage
of other pairs and refunds remains outstanding.

Validation on November 6, 2026:

| Check | Result |
| --- | --- |
| Configuration, TypeScript and lint | Passed |
| Vitest | 919 passed, including 66 NEAR cases |
| Browser review/cancellation regressions | 4 passed |
| Browser receipt/tracking regressions | 10 passed |
| Cloudflare production build | Passed; dependency/toolchain warnings remain |
| Local API request checks | Native/ERC-20 preparation, same-quote preflight and pending status returned 200; completed inbound receipt returned 200/SUCCESS |
| Production-server status checks | Unfunded inbound returned 200/PENDING_DEPOSIT; completed inbound and outbound returned 200/SUCCESS; all uncached |
| Live browser | Completed inbound receipt survived reload with both explorer links and no stale notification warning |
| Live catalog and 13 reverse dry quotes | All pinned identities matched; all 13 returned 201 with valid signatures |
| Funded execution | User-initiated Miden → Ethereum and Ethereum → Miden ETH transfers confirmed; remaining release checks are outstanding |

References: [1Click signatures](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature),
[SDK](https://docs.near-intents.org/integration/distribution-channels/1click-api/sdk),
[status](https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status),
[deposit notification](https://docs.near-intents.org/api-reference/oneclick/submit-deposit-transaction-hash).
