# Miden Frontend Integration

> Testnet only: this note is the bridge UI's Miden-specific implementation
> checklist. It follows the current `0xMiden/agentic-template` and
> `0xMiden/frontend-template` patterns.

Source references:

- `0xMiden/agentic-template`: https://github.com/0xMiden/agentic-template
- `0xMiden/frontend-template`: https://github.com/0xMiden/frontend-template
- Epoch bridging tutorial PR:
  https://github.com/0xMiden/tutorials/pull/199
- Provider setup:
  https://github.com/0xMiden/frontend-template/blob/main/src/providers.tsx
- Wallet button and readiness handling:
  https://github.com/0xMiden/frontend-template/blob/main/src/components/AppContent.tsx
- Wallet-submitted transaction pattern:
  https://github.com/0xMiden/frontend-template/blob/main/src/hooks/useIncrementCounter.ts

## Current State

This repo already installs the Miden SDK and MidenFi wallet adapter packages:

```text
@miden-sdk/react
@miden-sdk/miden-sdk
@miden-sdk/miden-wallet-adapter-react
@miden-sdk/miden-wallet-adapter-base
```

The app currently uses the MidenFi wallet adapter for account connection. It
does not yet use `MidenProvider` or the React SDK hooks for Miden client state,
balances, notes, or transactions. That means the UI can read a connected Miden
account, but it should not claim wallet-side note sync, note consume, or Miden
transaction submission until those flows are wired and verified.

## Provider Rules

When adding Miden React SDK hooks or raw client access, use the same provider
ordering as the frontend template:

```tsx
<MidenFiSignerProvider
  appName={APP_NAME}
  network={WalletAdapterNetwork.Testnet}
  autoConnect
>
  <MidenProvider
    config={{ rpcUrl: MIDEN_RPC_URL, prover: MIDEN_PROVER }}
    loadingComponent={<div>Loading Miden...</div>}
  >
    <App />
  </MidenProvider>
</MidenFiSignerProvider>
```

The order matters because `MidenProvider` reads signer context while it
initializes its external-keystore client.

Use `useMidenFiWallet()` for the wallet button. Gate connect behavior on
`wallet.readyState` so the app does not trigger extension install fallback while
the adapter is still detecting the wallet.

## Bridge Flow Mapping

### Wallet-Launched Bridge UI

When the Miden wallet opens this bridge UI, prompt the user to connect their
Miden and EVM wallets. Transfers always use their connected accounts.

- Cross-chain Receive: Miden is the destination, so the active Miden account is
  used automatically as the destination account.
- Cross-chain Send: Miden is the source, so the active Miden account is
  displayed as the source wallet. The destination resolves to the connected
  EVM wallet on the selected network.

Recipient addresses cannot be entered manually or overridden through launch URLs.

The launch URL accepts `provider` and `mode` (`receive` or `send`). For example:
`/?provider=xreserve&mode=receive`.
These are the only parameter names; unknown names and direction values are ignored.
A missing or invalid provider/direction uses the saved selection, then the default
available route. Legacy `midenAccount` and `evmAddress` parameters are ignored.

Stored receipts retain conversions for formats actually written by earlier
versions: text timestamps and encoded Agglayer recipient addresses from the
initial frontend (`364638b`), quoted amounts with token symbols (`a1158b6`),
and failure descriptions saved before `failureLeg`. Storage normalizes these
fields before presentation. Route lookup also resolves receipts saved before
explicit route IDs (`2a163d1`) by provider, direction, and token. An unknown
delivery timestamp stays empty. Unsupported providers and directions are ignored
rather than assigned another provider's behavior.

### Provider contract

Each provider owns two explicit directions in its existing folder:

- `provider.ts`: phase tables, phase resolution, fees and receipt facts for
  `receive` and `send`. This configuration has no React or wallet SDK runtime.
- `flows.ts`: `quote`, `submit` and `monitor` for both directions. The registry
  loads these operations on demand, so protocol SDKs stay out of server rendering.

The shared pipeline resolves the route and accounts, obtains a quote when the
fee policy requires one, freezes it for review, validates its expiry and request
identity at submission, then persists source acknowledgement before navigation.
Submission errors after that acknowledgement preserve the receipt. Polling
returns patches rather than activity snapshots; the common merger owns phase
ordering and timestamps.

Fee policies declare whether a fee is absent, included in the rate, paid on top,
or deducted from the payout. They also declare the label and whether amounts
are estimates. The form and receipt render those facts without protocol checks.
Provider-specific quote authorizations stay opaque to the UI.

Paused directions keep their implementations and phase tables for saved
receipts. xReserve `send` remains explicitly manual: a submitted or confirmed
burn does not prove that Circle paid the destination. Agglayer claims match a
known deposit ID exactly; another exit cannot complete the saved transfer.

### Cross-chain Receive

1. Connect Sepolia wallet.
2. Connect MidenFi wallet.
3. Check the connected receiving account in the destination wallet control.
4. Request the route quote.
5. Submit the Sepolia transaction through the EVM wallet.
6. Track source finality, bridge message observation, Miden claim-note
   availability, and wallet-side note consumption.

Bridge completion is not identical to wallet balance settlement. The Miden
balance updates only after the wallet syncs and consumes the claim or payout
note.

### Cross-chain Send

1. Connect MidenFi wallet.
2. Connect Sepolia wallet or enter a Sepolia recipient.
3. Build the Miden-side bridge note or route-specific transaction request from
   the quote.
4. Submit through `wallet.requestTransaction(...)`.
5. Track provider observation, settlement, claim availability, Sepolia claim tx,
   and completion.

For AggLayer, Miden-to-Sepolia send creates a wallet-native `B2AGG` note. The
Gateway service observes the exit and auto-claims it on Sepolia once the proof
is ready. The UI tracks the source transaction, bridge observation, and
destination claim as separate states.

### Wallet Swap Boundary

Swap is a wallet feature, not a Bridge UI mode. Wallet Swap may call the same
provider adapters and activity model, but the Bridge UI should remain focused on
Cross-chain Receive and Cross-chain Send. If a wallet swap ends on Miden,
completion still requires wallet sync and note consume when the provider creates
a Miden note.

### Wallet Earn Boundary

Earn is a wallet feature, not a Bridge UI mode. Epoch is the current testnet
route to track from `0xMiden/tutorials#199`. That PR adds a runnable
`examples/bridging-app` using the Epoch protocol intent SDK for Sepolia ->
Miden, Miden -> Sepolia, and Miden Wallet consumption of the delivered P2ID
note.

Carry these product constraints into wallet Earn and Activity:

- Miden -> EVM needs a reclaim height and must preserve the in-flight send
  quote if the user switches tabs or returns later.
- EVM -> Miden completion means the Miden wallet can consume the delivered
  P2ID note; the UI must not collapse that into generic provider success.
- The wallet adapter provider should be shared so the Miden wallet request
  popup is not triggered repeatedly during one page load.
- Balance display must be BigInt-safe and route-specific decimals must come
  from the faucet/token metadata, not hardcoded display math.

The wallet should show whether the user is entering a position, exiting one, or
claiming proceeds, and the activity detail should separate app status, bridge
status, claim status, and recovery actions.

## SDK Rules

- Prefer `@miden-sdk/react` hooks for accounts, notes, sync, and mutations.
- Use `useMidenClient()` only for operations not covered by hooks.
- Serialize raw client calls with `useMiden().runExclusive(...)`.
- Wait for Miden WASM readiness before rendering SDK-dependent components.
- Use `bigint` for token amounts.
- Sync before reading balances, notes, or account state.
- Use public notes only when provider or recipient discovery requires them.
- Use account-targeted tags, route-specific tags, or explicit subscriptions for
  notes that must be delivered during sync. Do not rely on `NoteTag(0)` for
  default wallet discovery.
- Treat wallet-submitted or externally consumed transactions differently from
  locally submitted transactions. Until a React SDK subscription primitive
  covers externally driven state changes, use bounded polling.
- Reject network mismatches before signing. A testnet bech32 account must not be
  used with a devnet provider configuration.

## Next.js Requirements

Do **not** set COOP/COEP/CORP on this app. Proving happens in the connected
Miden wallet, not in-page, and `Cross-Origin-Opener-Policy: same-origin`
breaks wallet-connector popups that need `window.opener`. The decision and
the revisit trigger are in
[docs/decisions/wasm-threading-coop-coep.md](decisions/wasm-threading-coop-coep.md);
`next.config.ts` encodes it.

If a future Next or Turbopack release changes `.wasm` asset handling, verify
the browser can load files like `/_next/static/media/miden_client_web...wasm`
before adding more in-page Miden client logic.

## Remaining Gaps

1. Rich Miden balance display by asset symbol/decimals instead of the current
   wallet adapter asset-count summary.
2. Miden note sync and consume prompts after Cross-chain Receive claim-note
   availability.
3. Tests that model both EVM wallet behavior and the MidenFi wallet adapter.
4. Browser verification with MidenFi installed, including connect, reconnect,
   reset, and popup-cancel recovery.
