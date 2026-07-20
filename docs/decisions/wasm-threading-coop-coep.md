# Decision: single-thread WASM, no cross-origin isolation (no COOP/COEP)

Status: **Accepted** — revisit per the trigger below.
Tracking: [#15](https://github.com/0xMiden/bridge-portal/issues/15).

## Decision

The bridge portal ships the **single-thread** `@miden-sdk/miden-sdk` build (the
`.` / eager `dist/st` entry) and **does not** set cross-origin isolation headers
(`Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`). This is the
choice already encoded in `next.config.ts`; this record captures the *why* and
the conditions under which it should change.

## Context

Multi-threaded WASM proving needs `SharedArrayBuffer`, which the browser only
exposes when the document is **cross-origin isolated**. Isolation requires:

- `COOP: same-origin`, and
- `COEP: require-corp` (or `credentialless`).

Turning that on has portal-wide side effects because this app is a wallet-facing
surface that leans heavily on cross-origin popups, iframes, and gRPC-Web.

## Why single-thread / no isolation (the current call)

1. **The heavy proving isn't in this app.** Note proving is delegated to the
   connected Miden wallet, not run in-page — the submit path is "the wallet
   approval + note proving happen here" and "the wallet proves + submits"
   (`src/app/components/BridgeExperience.tsx`, `src/app/lib/epoch/miden-note.ts`).
   There is **no** in-app prover instantiation (`grep` for `Prover` in `src/`
   returns nothing). So the portal captures little of threading's upside while
   paying its full compatibility cost. This is the decisive point.

2. **`COOP: same-origin` breaks wallet-connector popups.** Connectors that rely
   on `window.opener` (e.g. the Coinbase Wallet SDK) throw under
   `same-origin`. See
   <https://www.smartwallet.dev/guides/tips/popup-tips#cross-origin-opener-policy>.
   WalletConnect/AppKit popup and redirect flows are similarly sensitive.

3. **`COEP: require-corp` breaks the Miden note transport.** `transport.miden.io`
   (gRPC-Web) can fail to sync under COEP (observed
   `MissingContentTypeHeader`); every cross-origin subresource, image, and
   iframe would need to emit a matching `Cross-Origin-Resource-Policy` header,
   which third-party wallet/RPC endpoints do not control for us.

4. **The `mt` build is not actually available here.** The vendored SDK
   (`vendor/miden-sdk-miden-sdk-0.15.6-b2agg.callback.1.tgz`) declares `./mt`
   and `./mt/lazy` in its `exports` map, but **ships only `dist/st/`** — there
   is no `dist/mt/` in the tarball or in `node_modules`. Switching to threaded
   proving is therefore not a config flip; it needs a re-vendored (or upstream)
   SDK build that includes the `mt` artifacts, plus a cross-origin-isolated
   document to load them.

## What threading would cost / gain

**Gain:** faster *in-page* client-side proving when/if the portal ever proves
locally instead of delegating to the wallet. Miden proofs are the dominant
client cost, and threads parallelize them — a real win, but only for work this
app does not currently do.

**Cost:**
- Re-vendor or upstream an `mt` SDK build (not shipped today).
- Cross-origin isolate the document, then repair every popup/iframe/subresource
  broken by COOP/COEP: Coinbase + WalletConnect connectors, the gRPC-Web note
  transport, and any embedded third-party frames.
- Prefer `COEP: credentialless` over `require-corp` to avoid the blanket CORP
  requirement on cross-origin subresources, but connector popups still need the
  `COOP: same-origin-allow-popups` accommodation and per-connector validation.
- Ongoing fragility: any new cross-origin dependency must tolerate isolation.

## Trigger to revisit

Reopen this decision when **all** of the following hold:

1. The portal needs to prove **in-page** (proving moved off the wallet, or a
   flow requires local proving), and measured proving time is a real UX problem.
2. An `mt` SDK build is actually available to vendor/install (`dist/mt/`
   present), i.e. threaded proving is more than a config flag.
3. A cross-origin-isolation path exists that keeps the wallet connectors and the
   gRPC-Web transport working — e.g. `COEP: credentialless` +
   `COOP: same-origin-allow-popups`, validated end-to-end against Coinbase,
   WalletConnect/AppKit, and `transport.miden.io`.

Until then: keep single-thread, keep isolation off. Do not enable COOP/COEP
piecemeal — it is all-or-nothing for `SharedArrayBuffer` and breaks connectors
in the meantime.
