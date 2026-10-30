# Solana USDC to a manual Arc call

This implementation adds a Solana source to Receive. The source wallet control is **Phantom (Solana)**; Bread supplies the connected Miden recipient. The route burns Solana USDC through Circle CCTP V2 with Standard finality, then validates the finalized source occurrence and Circle attestation and simulates the Arc helper call.

The final activity is **Ready for manual Arc execution** and remains pending:

> A separate transaction on Arc is still required. USDCx has not been delivered.

The source burn is irreversible. The v1 helper provides no refund or recipient retarget. Source SOL pays the Solana transaction fee and Circle event-account rent. A later executor needs separate Arc gas. This UI neither signs nor sends the Arc transaction.

## Release configuration

Both `src/config/cctp-helper-public.json` and `src/config/cctp-helper-server.json` are empty in ordinary builds. The Solana route is visible but unavailable in both environments. There is no deployed helper address or activation switch in a request.

Activation requires an independently qualified deployment manifest accepted by `src/config/cctp-helper.ts`: stable deployment ID; helper runtime hash, ABI and deployment block; Arc chain and contract identities/runtime hashes; Miden domain/faucet/recipient codec and remote-domain depositor; canonical Solana genesis, mint, CCTP programs, pinned IDL hash, finalized history policy and start slot; and qualification evidence for helper-as-depositor, zero remote fee, Arc runtime, Phantom sign-only and source programs. Mainnet and testnet pairs cannot be mixed. Qualification evidence is a prerequisite, not something this frontend creates.

The matching server-only manifest selects Solana RPC, Arc RPC, Circle Iris environment and a documented nonprivileged simulation caller. Do not put credentials in the public manifest or commit credentials to either file. A disabled historical public entry and its server configuration remain available for observation; disabling an entry prevents a new source submission. Retain historical identities when changing releases.

Before a new quote, source simulation, source send or saved-byte resend, the app reads the destination Circle TokenMessenger's current `feeRecipient` after validating deployment identity. The helper itself is unsupported as this recipient, even when the current fee quote is zero: a saved transaction may authorize a positive fee, and Circle would then mint both principal and fee to the helper, violating its required net balance increase. Missing, malformed or unavailable getter results also stop new source admission. This mutable configuration must remain qualified; a preflight cannot guarantee its future state.

Historical finalized zero-fee transfers retain recovery: they use the shared destination checks and actual full helper simulation, without applying this new-burn restriction after the burn. A positive-fee transfer with the helper as fee recipient cannot produce a valid manual export while its full helper simulation reverts. Neither case permits changing the signed fee cap or creating a replacement burn.

## Source recovery

Only injected Phantom with `signTransaction` is supported. The app checks the captured account/provider before and after signing, preserves the Circle event signature, and verifies both signatures against the exact reviewed message. It does not substitute `signAndSendTransaction`.

A secure origin with the browser Web Locks API and working local storage is required for source submission. An origin-wide lock prevents competing tabs from signing while an attempt is active. Reviewed attempt data is saved before the wallet request; verified signed bytes are saved before broadcast. Failed saves stop that boundary. Keep the original tab open to retry an unsigned attempt or a signed transaction whose save failed. The activity recovery control only resends the same signed bytes and signature while their validity and route checks remain satisfied.

Unknown, unavailable, pruned or expired source history is not proof that no burn occurred. Keep the saved attempt; do not create another burn. No qualified no-burn history provider is configured in this slice. Signed source bytes are excluded from diagnostic and manual-call downloads.

## Manual bundle

**Download manual Arc call** requires fresh server validation and browser comparison with the saved review. The JSON contains the deployment, finalized source signature/slot/unique event identity, CCTP message and attestation, fee cap/executed fee/net amount, validation time, simulation caller, and exact helper calldata for `receiveAndDeposit(bytes message, bytes attestation)` with value zero. The destination message transmitter is called by the helper; there is no direct EOA mint step.

A manual executor must independently revalidate the deployment, message, attestation and current destination conditions and simulate the exact call before execution. The downloaded bundle is not a delivery receipt. Current validation failures disable export while retaining source evidence.

Fresh destination admission also verifies the configured GatewayWallet/GatewayMinter runtime and bindings, remote-domain depositor and empty hook, Gateway caller/beneficiary policy, native USDC blacklists, CCTP minter binding/role/allowance, and Gateway token support/allowance/pause state. CCTP mint allowance covers gross; historical Gateway allowance covers authenticated net. A new burn checks Gateway allowance against gross because the eventual CCTP fee can be zero. These reads do not reserve capacity or prevent policy changes after admission. The source policy runs again when source bytes are simulated or forwarded. Historical bundle validation applies incoming execution prerequisites and the full helper simulation; unrelated GatewayMinter, withdrawal-pause and send-body-limit policy does not block recovery. An authenticated zero-fee message also does not depend on the current fee recipient. Both registries remain empty pending genuine wallet/deployment and downstream qualification.

The new CCTP relayer is intentionally omitted from this slice. Existing xReserve attestation and Miden processing are still required downstream after the Arc helper transaction. This route does not track or claim their completion.

## Local fixture verification

Use Node **22.18.0**, install the lockfile dependencies and a Playwright Chromium runtime, then run:

```sh
npm run test:browser:helper
```

The runner copies the current source and exact installed dependencies into an isolated directory, applies synthetic deployment manifests only there, builds the production app, and runs the dedicated browser suite against local Solana/Arc/Iris services. The fixtures use public deterministic test keys, real serialized Solana signatures and a locally checked attestation. Never deploy a fixture build. The ordinary `npm run test:browser` suite excludes helper tests.

For a server/API-only diagnostic when Chromium cannot launch:

```sh
npm run test:browser:helper -- --http-only true
```

That command explicitly reports browser acceptance **NOT RUN**. It cannot replace the browser gate or qualification with a genuine Phantom extension and real deployments.
