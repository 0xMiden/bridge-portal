# Solana USDC to Miden through the Arc helper

This implementation adds a Solana source to Receive. The source wallet control is **Phantom (Solana)**; Bread supplies the connected Miden recipient. The route burns Solana USDC through Circle CCTP V2 with Standard finality, then validates the finalized source occurrence and Circle attestation. An independent worker can execute the Arc helper; the ordinary UI observes its finalized result and downstream delivery.

Activity tracks source finality, Circle attestation, finalized Arc helper/xReserve execution and the exact recipient P2ID note inclusion on Miden. Note inclusion means delivered; wallet claim/consume is separate. Incoming USDCx may cover claim fees when the wallet/protocol permits and the amount suffices. No Arc wallet is required for the automatic path.

The source burn is irreversible. The v1 helper provides no refund or recipient retarget. Source SOL pays the Solana transaction fee and Circle event-account rent. A later executor needs separate Arc gas. This UI neither signs nor sends the Arc transaction.

## Release configuration

Both `src/config/cctp-helper-public.json` and `src/config/cctp-helper-server.json` are empty in ordinary builds. The Solana route is visible but unavailable in both environments. There is no deployed helper address or activation switch in a request.

Activation requires an independently qualified deployment manifest accepted by `src/config/cctp-helper.ts`: stable deployment ID; helper runtime hash, ABI and deployment block; Arc chain and contract identities/runtime hashes; Miden domain/faucet/recipient codec and remote-domain depositor; canonical Solana genesis, mint, CCTP programs, pinned IDL hash, finalized history policy and start slot; and qualification evidence for helper-as-depositor, zero remote fee, Arc runtime, Phantom sign-only and source programs. Mainnet and testnet pairs cannot be mixed. Qualification evidence is a prerequisite, not something this frontend creates.

The server-only `CCTP_HELPER_SERVERS_JSON` runtime variable selects Solana RPC, Arc RPC, Circle Iris environment and a documented nonprivileged simulation caller. A present value replaces the tracked server array without merging or fallback on invalid input. See [README](../README.md#cctp-helper-configuration-and-recovery) and `.env.example`; private endpoints belong in ignored local environment files or deployment secret bindings, never public JSON or `NEXT_PUBLIC_*`. A disabled historical public entry and its server configuration remain available for observation; disabling an entry prevents a new source submission. Retain historical identities when changing releases.

Before a new quote, source simulation, source send or saved-byte resend, the app reads the destination Circle TokenMessenger's current `feeRecipient` after validating deployment identity. The helper itself is unsupported as this recipient, even when the current fee quote is zero: a saved transaction may authorize a positive fee, and Circle would then mint both principal and fee to the helper, violating its required net balance increase. Missing, malformed or unavailable getter results also stop new source admission. This mutable configuration must remain qualified; a preflight cannot guarantee its future state.

Historical finalized transfers retain authenticated observation even if new admission is disabled or a replay simulation would fail. Observation verifies the finalized helper/transmitter/xReserve receipt tuple and the distinct matching xReserve DepositIntent nonce before looking up the exact Miden note. A fresh manual export still requires current incoming execution checks and full helper simulation. A positive-fee transfer with the helper as fee recipient cannot produce a valid export while that simulation reverts. None of these states permits changing the signed fee cap or creating a replacement burn.

## Source recovery

Only injected Phantom with `signTransaction` is supported. The app checks the captured account/provider before and after signing, preserves the Circle event signature, and verifies both signatures against the exact reviewed message. It does not substitute `signAndSendTransaction`.

A secure origin with the browser Web Locks API and working local storage is required for source submission. An origin-wide lock prevents competing tabs from signing while an attempt is active. Reviewed attempt data is saved before the wallet request; verified signed bytes are saved before broadcast. Failed saves stop that boundary. Keep the original tab open to retry an unsigned attempt or a signed transaction whose save failed. A saved-byte resend only sends the same signed bytes and signature while their validity and route checks remain satisfied. Normal Activity recovery can also import the original finalized Solana source signature after reload or storage loss; it authenticates the source occurrence and reviewed destination without requesting another burn. An optional Arc transaction hash is a locator, never completion proof. A wrong hash cannot unlock the source or advance the canonical scan cursor.

Unknown, unavailable, pruned or expired source history is not proof that no burn occurred. Keep the saved attempt; do not create another burn. No qualified no-burn history provider is configured in this slice. Signed source bytes are excluded from diagnostic and manual-call downloads.

## Tracking and manual fallback

New attempts save a finalized Arc anchor before source signing. Each observation scans at most one bounded finalized log page and persists its cursor; imported or legacy transfers begin at the pinned deployment block. Provider outages retain proven progress. Ambiguous multi-deposit receipts stay pending for review instead of choosing the first reserve nonce. Current admission failures cannot erase verified historical completion.

**Download manual Arc call** is a fallback for an unexecuted transfer and requires fresh server validation and browser comparison with the saved review. The JSON contains the deployment, finalized source signature/slot/unique event identity, CCTP message and attestation, fee cap/executed fee/net amount, validation time, simulation caller, and exact helper calldata for `receiveAndDeposit(bytes message, bytes attestation)` with value zero. The destination message transmitter is called by the helper; there is no direct EOA mint step.

A manual executor must independently revalidate the deployment, message, attestation and current destination conditions and simulate the exact call before execution. The downloaded bundle is not a delivery receipt. Current validation failures disable export while retaining source evidence.

Fresh destination admission also verifies the configured GatewayWallet/GatewayMinter runtime and bindings, remote-domain depositor and empty hook, Gateway caller/beneficiary policy, native USDC blacklists, CCTP minter binding/role/allowance, and Gateway token support/allowance/pause state. CCTP mint allowance covers gross; historical Gateway allowance covers authenticated net. A new burn checks Gateway allowance against gross because the eventual CCTP fee can be zero. These reads do not reserve capacity or prevent policy changes after admission. The source policy runs again when source bytes are simulated or forwarded. Historical bundle validation applies incoming execution prerequisites and the full helper simulation; unrelated GatewayMinter, withdrawal-pause and send-body-limit policy does not block recovery. An authenticated zero-fee message also does not depend on the current fee recipient. Both production registries remain empty pending genuine wallet/deployment and downstream qualification.

The independent incoming worker is available on the backend branches documented in the README; the local-env testnet signer needs no AWS login. Existing xReserve attestation and Miden mint processing remain required downstream after the Arc helper transaction. The UI tracks authenticated reserve correlation and exact note inclusion, and never infers recipient claim from a used nonce, balance or Arc receipt.

## Local fixture verification

Use Node **22.18.0**, install the lockfile dependencies and a Playwright Chromium runtime, then run:

```sh
npm run test:browser:helper
```

The runner copies the current source and exact installed dependencies into an isolated directory, applies a synthetic qualified public manifest and server-only environment providers only there, proves the original source registries/lock unchanged, builds the production app, and runs the dedicated browser suite against local Solana/Arc/Iris services. The fixtures use public deterministic test keys, real serialized Solana signatures and a locally checked attestation. Never deploy a fixture build. The ordinary `npm run test:browser` suite excludes helper tests.

For a server/API-only diagnostic when Chromium cannot launch:

```sh
npm run test:browser:helper -- --http-only true
```

That command explicitly reports browser acceptance **NOT RUN**. It cannot replace the browser gate or qualification with a genuine Phantom extension and real deployments.
