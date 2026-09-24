import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { AGGLAYER_BALI } from "./agglayer";
import {
  EVM_AGGLAYER_NETWORK_ID,
  MIDEN_AGGLAYER_FAUCET_ID,
  MIDEN_BRIDGE_ID,
} from "./agglayer-b2agg";
import {
  MIDEN_DESTINATION_CHAIN_ID,
  MIDEN_NATIVE_FAUCET_ID,
  MIDEN_NATIVE_TOKEN_DECIMALS,
  MIDEN_NATIVE_TOKEN_SYMBOL,
} from "./epoch/config";

// Frozen testnet pins. Changing a value here is a protocol/deploy event:
// add a CHANGELOG line and check 0xMiden/wallet's matching constants.

describe("testnet pin freeze", () => {
  it("keeps the AggLayer bali ids", () => {
    expect(MIDEN_BRIDGE_ID).toBe("0xa22ec154f9a36d911953fd5c9260a7");
    expect(MIDEN_AGGLAYER_FAUCET_ID).toBe("0x387149ae66116cf114eebd60bb7381");
    expect(EVM_AGGLAYER_NETWORK_ID).toBe(0);
    expect(AGGLAYER_BALI.destinationNetworkId).toBe(78);
    expect(AGGLAYER_BALI.sepoliaChainId).toBe(11155111);
    expect(AGGLAYER_BALI.sepoliaBridgeAddress).toBe(
      "0x1348947e282138d8f377b467f7d9c2eb0f335d1f",
    );
    expect(AGGLAYER_BALI.midenEthFaucetIdHex).toBe(MIDEN_AGGLAYER_FAUCET_ID);
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
