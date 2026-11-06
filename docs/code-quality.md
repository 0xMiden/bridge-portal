# Circle and Agglayer bridge quality gates

`npm run lint` enforces these gates in CI for the Circle quote and USDC approval
implementation, withdrawal quote validation, their API handlers, the shared
quote-validity model, CCTP/Arc status services, manual CCTP helper flows,
Solana source validation and their API handlers, the complete Agglayer provider and its API handlers, and the shared EVM deposit,
approval persistence, and transaction recovery helpers:

| Gate | Limit |
| --- | --- |
| Cognitive complexity | 10 per function, measured by SonarJS |
| Control-flow nesting | 2 levels, including `try` blocks |
| Boolean expressions | 3 clauses joined by `&&` or `||`, including parenthesized and negated groups |
| Function length | 40 nonblank, noncomment lines, including the declaration |
| Explicit `any` and non-null assertions | Not allowed |

The function-length gate is deliberately strict for this implementation. Moving
a large function into a factory or nesting callbacks does not exempt its lines.
Nullish fallbacks (`??`) are not boolean clauses. Tests retain the normal lint
rules; their table-driven fixtures are evaluated for behavioral coverage rather
than production function size.

The enforced file patterns are in `eslint.config.mjs`. The existing transfer UI,
shared submission function, Epoch quote producer, and browser activity observer receive only
consumer or import changes in this refactor. Their pre-existing function sizes are
outside this gate's scope; the new validity decision they call is enforced in
`src/bridge/core/quote.ts`. Adding new quote/approval logic to those consumers to
avoid these gates is not acceptable.

CCTP status tracking has no file exemption. Its protocol codec owns binary field
positions; private helpers in each status service validate Circle responses and
bind them to on-chain transfers. The typed Arc service consumes
the receipt already fetched by CCTP; only the HTTP adapter constructs a `Response`.
Temporary status failures preserve verified source details, while transfer-binding
failures remain errors.

File boundaries follow cohesive operations, not individual helpers:

- `cctp-quote.ts` owns the browser quote lifecycle: fetching, validation, fee
  limits and reuse. Its schemas remain shared with the server API.
- Each server status module owns its Circle lookup and on-chain verification,
  keeping the steps in named private functions. Protocol codecs stay separate.
- `cctp-burn.ts` owns the canonical burn call and its executor hook encoding and
  decoding. `config.ts` owns the provider's deployment and contract configuration.
- `circle-response.ts` owns payload parsing and classified errors;
  `circle-http.server.ts` owns upstream transport and safe diagnostics.
- Approval lifecycle and durable browser storage remain separate responsibilities.
  Browser wallet execution, server APIs and Miden delivery also remain separate.

Keep single-consumer helpers private when they belong to the same operation.
Do not add barrels or wrapper exports just to preserve obsolete file boundaries.
Withdrawal payout tracking is manual; there is no unused network-note observer.
Saved burn states remain readable and never establish that Circle paid out USDC.

The numerical checks support these review requirements:

- Parse external JSON and persisted browser state through declarative schemas.
  Domain checks consume verified types; a cast is not validation.
- Share the EVM transaction schema between RPC recovery and persisted approvals.
  Keep the inferred identity type with its schema.
- Preserve Circle failure categories and safe schema paths in server diagnostics.
  Never log provider payloads, wallet addresses, or raw error messages.
- Keep response structure, authorization binding, requested services, and
  claimability consistency as separate, named rules with useful failures.
- Keep protocol construction in one owner. Circle validation and wallet execution
  use the same burn-call builder.
- Make the submission order visible: validate, satisfy allowance, reuse or
  refresh the quote, simulate, check the final window, then request the signature.
- Preserve behavior tests for quote reuse, fee limits, expiry, cancellation,
  pending approval retries, and recovery after reload. New regressions must fail
  against the faulty implementation for the intended reason.
- Multichain test clients must reject calls on the wrong chain, transport, or
  contract. Unknown reads must fail instead of returning a permissive default.

A passing lint or test run does not replace reviewing the normal flow and each
failure path. Avoid suppressions or extra indirection solely to satisfy a metric.

## Agglayer

All production TypeScript under `src/bridge/providers/agglayer/` and all Agglayer
API routes use the same gates above. New helper files inherit them. The existing
CI `npm run lint` step enforces this scope without separate commands or exemptions.

- `status-schema.ts` owns runtime schemas and inferred types for indexer pages,
  deposit status, withdrawal identities, and chain observations. Missing optional
  evidence does not imply delivery; malformed evidence is rejected.
- `agglayer-status.ts` owns bounded, abortable pagination and source/exit identity
  matching. The deposits HTTP adapter maps upstream failures to a safe 502.
- `activity-observation.ts` keeps source, destination, and deposit transitions
  separate. Independent source evidence survives an indexer outage.
- `deposit.ts` owns wallet checks and submission order; `approval.ts` reconciles
  pending approvals before any zero reset or exact approval. Empty USDT return
  data remains supported; a returned false blocks submission.
- Shared `evm/approval-store.ts` preserves existing Circle storage keys and parses
  persisted records. Agglayer also saves the approved amount, including zero,
  before metadata/receipt requests. Reloads resume that transaction; timeouts do
  not authorize another signature. Cancelled or unrelated replacements stop the
  attempt, while repriced approvals retain their recovery state.
- Withdrawal recovery keeps the explorer locator separate from the node's verified
  transaction inclusion and output commitments. Its wire codec stays private.

Tests exercise malformed upstream data, bounded pagination, approval/reset recovery
across module reloads, replacement handling, and the existing submission/monitoring
behavior. Live wallets and network settlement remain separate integration checks.
