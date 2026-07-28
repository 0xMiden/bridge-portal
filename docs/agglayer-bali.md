# AggLayer Bali Integration

This UI has a first live AggLayer testnet slice for Cross-chain Receive from
Ethereum Sepolia into Miden testnet.

## Supported now

- Route: Sepolia to Miden.
- Action: `bridgeAsset(uint32,address,uint256,address,bool,bytes)` on the Sepolia bridge contract.
- Contract: `0x1348947e282138d8f377b467f7d9c2eb0f335d1f`.
- Destination network ID: `78`.
- Token: native Sepolia ETH.
- Wallet: WalletConnect when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set,
  with `window.ethereum` as a local extension fallback.
- Status: proxied through `/api/agglayer/deposits`, which polls Gateway FM's Miden bridge status API.
- Public evidence: Gateway FM's Bali bridge monitor at
  `https://gateway-fm.github.io/miden-agglayer/bridge-monitor/bali/`.

The UI accepts either a Miden testnet bech32 account address, such as the
address returned by the Miden wallet extension, or the 30-hex Miden account ID
printed by `miden client new-wallet`. It maps the account ID into the 20-byte
bridge destination slot as:

```text
0x00000000<MIDEN_ACCOUNT_ID>00
```

## Cross-chain Send support

Cross-chain Send from Miden to Sepolia creates a `B2AGG` bridge note through the
connected Miden wallet. Gateway FM observes the exit and auto-claims it on
Sepolia once the proof is ready.

The Activity detail page keeps these states separate:

- Miden bridge note submitted.
- Gateway FM proof ready.
- Sepolia auto-claim submitted.
- Sepolia claim settled.

## Product behavior

- AggLayer Cross-chain Receive submits a real Sepolia transaction.
- AggLayer activity receipts link to Etherscan, Midenscan, and the Gateway FM
  Bali monitor so the frontend can show both wallet-local state and public
  bridge evidence.
- AggLayer Cross-chain Send creates the wallet-native `B2AGG` note and tracks
  Gateway's Sepolia auto-claim.
- Activity details poll bridge status and update the receipt once the bridge
  service reports a bridge event for the destination.
- A Sepolia-to-Miden bridge is delivered when the Miden claim transaction
  creates the recipient note. The user still consumes that note in Bread before
  the asset appears in the spendable balance.

## Tailnet preview

Use the Homelab route when reviewing the UI on Brian's Mac Studio:

```text
https://homelab.tail477b3c.ts.net:9001/
```

The health check is:

```text
https://homelab.tail477b3c.ts.net:9001/health
```

## Constant hygiene

The upstream Bali bridge docs are still in review, and some examples have used
older network IDs. This UI follows the current bridge backend defaults for the
testnet helper. Recheck `AGGLAYER_BALI` in `src/app/lib/agglayer.ts` before a
funded testnet run.
