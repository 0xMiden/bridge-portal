import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { AGGLAYER_TESTNET, normalizeMidenAccountHex } from "../../bridge/providers/agglayer/agglayer";
import {
  EVM_AGGLAYER_NETWORK_ID,
  MIDEN_AGGLAYER_FAUCET_ID,
  MIDEN_BRIDGE_ID,
} from "../../bridge/providers/agglayer/agglayer-b2agg";
import {
  MIDEN_DESTINATION_CHAIN_ID,
  MIDEN_NATIVE_FAUCET_ID,
  MIDEN_NATIVE_TOKEN_DECIMALS,
  MIDEN_NATIVE_TOKEN_SYMBOL,
} from "../../bridge/providers/epoch/config";

// Frozen testnet pins. Changing a value here is a protocol/deploy event:
// add a CHANGELOG line and check 0xMiden/wallet's matching constants.

describe("testnet pin freeze", () => {
  it("keeps the confirmed Cardona testnet deployment", () => {
    expect(MIDEN_BRIDGE_ID).toBe("0x187cabbc404359d16be94954ca9879");
    expect(MIDEN_AGGLAYER_FAUCET_ID).toBe("0x7c6d1dc7fb7045913d524bbef017f5");
    expect(EVM_AGGLAYER_NETWORK_ID).toBe(0);
    expect(AGGLAYER_TESTNET.destinationNetworkId).toBe(73);
    expect(AGGLAYER_TESTNET.sepoliaChainId).toBe(11155111);
    expect(AGGLAYER_TESTNET.sepoliaBridgeAddress).toBe(
      "0x528e26b25a34a4a5d0dbda1d57d318153d2ed582",
    );
    expect(AGGLAYER_TESTNET.bridgeServiceApi).toBe("https://bridge.miden-testnet.gateway.fm/api");
    expect(AGGLAYER_TESTNET.midenEthDecimals).toBe(8);
    expect(AGGLAYER_TESTNET.midenEthFaucetIdHex).toBe(MIDEN_AGGLAYER_FAUCET_ID);
    expect(`0x${normalizeMidenAccountHex(AGGLAYER_TESTNET.midenEthFaucetId)}`).toBe(MIDEN_AGGLAYER_FAUCET_ID);
  });

  it("keeps the Epoch USDC faucet (not the MIDEN token)", () => {
    expect(MIDEN_NATIVE_FAUCET_ID).toBe("0x537c15a622074e91188aa894456c52");
    expect(MIDEN_NATIVE_TOKEN_SYMBOL).toBe("USDC");
    expect(MIDEN_NATIVE_TOKEN_DECIMALS).toBe(6);
    expect(MIDEN_DESTINATION_CHAIN_ID).toBe(999999999);
  });

  it("keeps the bridgeAsset ABI shape", () => {
    const fingerprint = [
      "bridgeAsset",
      "uint32 destinationNetwork",
      "address destinationAddress",
      "uint256 amount",
      "address token",
      "bool forceUpdateGlobalExitRoot",
      "bytes permitData",
    ].join("\n");
    expect(createHash("sha256").update(fingerprint).digest("hex")).toBe(
      "c96a45a92f7a54be55c386567dbc57278988426ba66396faf27cf391c38250a9",
    );
  });
});
