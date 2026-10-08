# USDCx bridge (testnet origins → Miden Testnet)

Select **USDCx** in the main bridge route selector, or open
`/?provider=xreserve&mode=receive`. The previous `/arc` URL redirects there.
This is a deposit-only route; withdrawals are visibly disabled.

The origin selector supports Arc Testnet (direct xReserve), Ethereum Sepolia,
Base Sepolia and Arbitrum Sepolia. The latter three use Circle CCTP forwarding
to the Arc executor, which deposits into xReserve for the Miden recipient.
Selecting a chain keeps USDCx as the Miden asset, and a refresh restores the
selected origin. Ethereum Sepolia's Circle USDC is a different contract from
Epoch's 18-decimal test USDC; token choices and balances distinguish them.

## CCTP forwarding

| Origin | Chain ID | Circle domain | Native Circle USDC (6 decimals) |
| --- | --- | --- | --- |
| Ethereum Sepolia | 11155111 | 0 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Base Sepolia | 84532 | 6 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Arbitrum Sepolia | 421614 | 3 | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |

All three use TokenMessengerWithFees
`0x8745D906D67C346E5eb1aEEED38Eb87F34DF0C0A`, the Arc executor
`0xEdC81040756AcCfF070c21D37b265b9D0b5Ba45e`, and DepositForHandler
`0xD05E7D2E7d30b92c5F17d7d0fC575fce231F1A48`.

The hook uses the verified contracts' composable framing, with the handler
injecting the minted amount into `depositToRemote` at byte offset 4. The wallet
address is the recovery address; the Miden recipient is encoded with the suffix
padding byte. `/api/xreserve/quote` obtains a signed PRE_FINALITY + FORWARD quote.
Circle fees are paid separately in source USDC, and gas uses source ETH.
The review shows the fee and total USDC. Submission refreshes the quote and
checks its fee against `getFee`; a higher fee requires a new review.

Tracking retains the source burn hash. It verifies the source `MessageSent`,
matches immutable message bytes against Circle's attestation, matches its nonce
to the Arc executor's `Executed` event, and checks the resulting xReserve
deposit. It then uses the same Miden note inclusion check as direct Arc deposits.
Neither CCTP forwarding nor an xReserve attestation alone marks delivery complete.

Read-only checks on 2026-10-08 confirmed active executor/handler contracts and
valid signed quotes for all three origins. Each quote's fee and token matched
the deployed source fee contract. These checks do not replace a funded round trip.

Sources: [Circle contract addresses](https://developers.circle.com/cctp/references/contract-addresses),
[upfront quotes](https://developers.circle.com/cctp/concepts/upfront-fee-quotes),
[USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses),
[verified Arc executor](https://explorer.testnet.arc.io/address/0xEdC81040756AcCfF070c21D37b265b9D0b5Ba45e?tab=contract).

## Deployment and protocol

- Arc Testnet chain ID: `5042002`; Circle domain: `26`.
- Miden Circle domain: `10007`.
- xReserve: `0x008888878f94C0d87defdf0B07f46B93C1934442`.
- Arc USDC ERC-20: `0x3600000000000000000000000000000000000000`, 6 decimals.
  Native USDC gas uses the same balance, exposed with 18 decimals.
- Miden v0.17 USDCx faucet: `0x4cbdcaffe75f0a317482224dae6436`, 6 decimals.
- SDK: `@miden-sdk/miden-sdk` 0.17.1; React and wallet adapters 0.17.0.
- Circle attestation API: `https://xreserve-api-testnet.circle.com`.

Read-only verification on 2026-10-08 returned `true` for
`isRemoteDomainRegistered(10007)` and the expected padded faucet from
`getRemoteToken(10007, USDC)`. Execution repeats both checks before approval.
This does not guarantee Circle activation or relayer availability; contract
simulation must succeed before the deposit signature.

Sources: [Arc network reference](https://docs.arc.io/arc/references/connect-to-arc),
[Circle contract](https://github.com/circlefin/evm-xreserve-contracts/blob/master/src/modules/x-reserve/DepositToRemote.sol),
[v0.17 faucet/service announcement](https://midengroup.slack.com/archives/C0A7LATPJ84/p1791456556003869),
[v0.17.1 note derivation](https://github.com/0xMiden/protocol/blob/v0.17.1/crates/miden-usdcx/src/note/xreserve_mint.rs).

## Execution and tracking

USDCx lives under `src/bridge/providers/xreserve`. The application uses the
same asset registry, account/asset balance store, submission entry point,
activity persistence, and receipt as the other bridges. It does not have a
separate page or activity store.

Selecting assets, connecting a wallet, and reviewing a transfer leave the wallet
network unchanged. Confirming a deposit automatically requests the source EVM
network if needed; rejecting that request preserves the form for another try.
The direct Arc deposit approves exactly the amount if needed,
and submits `depositToRemote` with `maxFee=0` and an empty hook. Zero is an
**authorized maximum**, not a live fee quote. The contract must accept that
ceiling or the simulation fails. The form preserves all six decimal places;
execution rejects rounding, zero, exponent notation, and amounts beyond the
Miden asset limit. Keep some Arc USDC for gas. Account and chain are checked
again after approval and after deposit simulation.

All origins share `/api/evm/[network]` for balances, RPC, gas and transactions.
Browser reads and simulations use its `/rpc` read-method allowlist; Arc uses
`/api/evm/arc-testnet/rpc`. Wallet signing/broadcast never uses that proxy. Override
`NEXT_PUBLIC_ARC_RPC_URL` at build time if needed. Public reads also back
`/api/evm/arc-testnet/balance`; cached balances include network, account, and token identity.

The source hash is saved immediately after broadcast. The actual sender, nonce
and call data are then captured without delaying navigation. While the source
transaction is pending, tracking saves any missing metadata and checks whether
the nonce has been mined. If replaced, historical nonce reads locate its block:
identical call data continues under the new hash, while cancellations and other
replacement operations get distinct terminal messages. The original hash stays
in diagnostics. This works after reload when the transaction metadata was saved;
if an older transaction disappeared before capture, its replacement hash must be
recovered from the wallet. RPC failures never imply a cancellation.

A later error never marks a broadcast deposit failed or suggests retrying it. Saved transfers resume
from the shared activity history. The bridge form has no separate hash-entry
recovery UI; USDCx uses the same form layout as the other routes.
`/api/xreserve/status?network=…&hash=…` tracks both direct Arc and CCTP deposits. It
verifies the actual xReserve event and rejects unrelated transactions, obsolete
faucets, and unsupported deposit terms.

The status API checks Circle's payload against the on-chain event. The client
also compares it with the saved amount, recipient, sender and faucet. Circle
attestation alone is not delivery: the v0.17 SDK derives the exact P2ID note
from the attested nonce, amount, faucet and recipient, and reads its inclusion
proof through Miden RPC. Only inclusion advances the activity to complete.
The receipt displays a **note ID**, never presents it as a transaction hash,
and links the Miden recipient account. Delivery does not imply consumption:
the recipient must consume the note in Bread for a spendable balance.

Tracking runs every 12 seconds while the receipt is open, resumes on reload,
and supports manual refresh. RPC/Circle errors preserve the last state.
A reminder after 15 minutes is not an SLA or evidence of relayer failure.

## Verification

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run check:wasm-size`.
`npm run check:usdcx-note` runs the actual browser WASM in CI against an
independent Rust v0.17.1 reference. Reproduce the reference with:

```sh
CARGO_TARGET_DIR=/tmp/arc-note-reference-target cargo +1.98.1 run --locked --manifest-path scripts/fixtures/arc-note-reference/Cargo.toml
```

The reference checks the current faucet/distributor with a fixed nonce:
`0xc8ee349db41b2d9296564360ec5d0f9f72654a4c8238b74dcf21861a7a4ef2a5`.
Changing the nonce or amount must change the note ID.

No real deposit is signed by automated validation. A funded wallet round trip
(deposit → delivered note → consumed balance) still needs live confirmation.
The existing Epoch and Agglayer deployments require independent v0.17
verification; their addresses are not replaced with USDCx addresses.
Withdrawals need a verified burn flow and a status API connecting the burn
note to the Circle withdrawal and final payout before enabling a route.
