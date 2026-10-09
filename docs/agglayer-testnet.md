# AggLayer Cardona Testnet Integration

The UI supports ETH deposits and withdrawals between Ethereum Sepolia and
Miden testnet through the Cardona deployment. Gateway confirmed this deployment
and tested both directions on 2026-10-09. Agglayer withdrawals are enabled for
retesting the portal's send flow; USDCx remains deposits only.

Source: [Gateway deployment parameters in Slack](https://midengroup.slack.com/archives/C0A1LENARH9/p1791550662283559).

## Supported now

- Routes: Sepolia to Miden and Miden to Sepolia.
- Deposit action: `bridgeAsset(uint32,address,uint256,address,bool,bytes)` on the Sepolia bridge contract.
- Withdrawal action: a `B2AGG` bridge-out note submitted through Bread.
- Contract: `0x528e26b25a34a4a5d0dbda1d57d318153d2ed582`.
- Destination rollup ID: `73` (synthetic EVM chain ID: `604208969`).
- Miden bridge account: `0x187cabbc404359d16be94954ca9879`.
- Wrapped ETH faucet: `0x7c6d1dc7fb7045913d524bbef017f5` (8 decimals; 1 unit = 1e10 wei).
- Bridge API: `https://bridge.miden-testnet.gateway.fm/api`.
- Withdrawal indexer network ID: `73`; Sepolia destination network ID: `0`.
- Token: native Sepolia ETH.
- Wallet: WalletConnect when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set,
  with `window.ethereum` as a local extension fallback.
- Status: proxied through `/api/agglayer/deposits`, which polls Gateway FM's Miden bridge status API.
- Verified withdrawal: [Sepolia claim transaction](https://sepolia.etherscan.io/tx/0x25e3c1b537543c268ebec10a1b4c5a02f3fdb26e85bf6f9529b18207ad9040b8).
  Its API deposit row reports `network_id: 73` and `dest_net: 0`.

The UI accepts either a Miden testnet bech32 account address, such as the
address returned by the Miden wallet extension, or the 30-hex Miden account ID
printed by `miden client new-wallet`. It maps the account ID into the 20-byte
bridge destination slot as:

```text
0x00000000<MIDEN_ACCOUNT_ID>00
```

## Withdrawals

Select Agglayer and Send, connect Bread, and use Show balance to resolve the
wrapped ETH asset. Enter a Sepolia recipient or connect an EVM wallet, then
review and confirm the withdrawal in Bread. Saved withdrawal selections and
launch links open Send directly.

Gateway FM observes `B2AGG` exits and auto-claims them on Sepolia once the proof
is ready. Existing withdrawal receipts continue tracking the same lifecycle.

The Activity detail page keeps these states separate:

- Miden bridge note submitted.
- Gateway FM proof ready.
- Sepolia auto-claim submitted.
- Sepolia claim settled.

## Product behavior

- AggLayer Cross-chain Receive submits a real Sepolia transaction.
- AggLayer activity receipts link to Etherscan and Midenscan for public
  transaction evidence.
- AggLayer Cross-chain Send submits a Miden bridge-out note and tracks Gateway's
  Sepolia auto-claim. Wallet and submission errors are shown on the form.
- Activity details poll bridge status and update the receipt once the bridge
  service reports a bridge event for the destination.
- A Sepolia-to-Miden bridge is delivered when the Miden claim transaction
  creates the recipient note. The user still consumes that note in Bread before
  the asset appears in the spendable balance.

## Constant hygiene

This deployment replaces the retired Bali rollup 86 configuration. The Cardona
indexer uses rollup ID 73 for Miden exits, replacing the previous local index 1.
Recheck `AGGLAYER_TESTNET` in `src/bridge/providers/agglayer/agglayer.ts` and the
Gateway deployment announcement before a funded testnet run.
