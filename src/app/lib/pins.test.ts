import { MIDEN_USDC } from "../../bridge/core/assets";
import { describe, expect, it } from "vitest";

import { agglayerConfig } from "../../bridge/providers/agglayer/agglayer";
import {
  MIDEN_DESTINATION_CHAIN_ID,
} from "../../bridge/providers/epoch/config";

// Frozen testnet pins. Changing a value here is a protocol/deploy event:
// add a CHANGELOG line and check 0xMiden/wallet's matching constants.

describe("testnet pin freeze", () => {
  it("keeps the confirmed Cardona testnet deployment", () => {
    expect(agglayerConfig().midenBridgeId).toBe("0x187cabbc404359d16be94954ca9879");
    expect(agglayerConfig().midenEthFaucetIdHex).toBe("0x7c6d1dc7fb7045913d524bbef017f5");
    expect(agglayerConfig().sourceNetworkId).toBe(0);
    expect(agglayerConfig().destinationNetworkId).toBe(73);
    expect(agglayerConfig().sepoliaChainId).toBe(11155111);
    expect(agglayerConfig().sepoliaBridgeAddress).toBe(
      "0x528e26b25a34a4a5d0dbda1d57d318153d2ed582",
    );
    expect(agglayerConfig().bridgeServiceApi).toBe("https://bridge.miden-testnet.gateway.fm/api");
    expect(agglayerConfig().midenEthDecimals).toBe(8);
  });

  it("keeps the Epoch USDC faucet (not the MIDEN token)", () => {
    expect(MIDEN_USDC.faucetId).toBe("0x537c15a622074e91188aa894456c52");
    expect(MIDEN_USDC.symbol).toBe("USDC");
    expect(MIDEN_USDC.decimals).toBe(6);
    expect(MIDEN_DESTINATION_CHAIN_ID).toBe(999999999);
  });
});
