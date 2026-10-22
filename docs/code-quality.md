# Quote and approval quality gates

`npm run lint` enforces these gates in CI for the Circle quote and USDC approval
implementation, withdrawal quote validation, their API handlers, the shared
quote-validity model, and the EVM deposit and transaction recovery helpers:

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
shared submission function, Epoch quote producer, and tracking code receive only
consumer or import changes in this refactor. Their pre-existing function sizes are
outside this gate's scope; the new validity decision they call is enforced in
`src/bridge/core/quote.ts`. Adding new quote/approval logic to those consumers to
avoid these gates is not acceptable.

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
