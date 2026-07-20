import { describe, expect, it } from "vitest";
import {
  type Activity,
  evmWalletIdentity,
  midenWalletIdentity,
  sourceExplorer,
} from "./bridge-state";

// Minimal Agglayer send activity; only the fields sourceExplorer reads matter.
function agglayerSend(overrides: Partial<Activity>): Activity {
  return {
    id: "act-test",
    mode: "send",
    provider: "agglayer",
    summary: "",
    status: "source_finality",
    eta: "",
    amount: "1",
    asset: "ETH",
    txHash: "0xpending",
    updatedAt: 0,
    ...overrides,
  };
}

const REAL_TX =
  "0x5c33e4d463046d68706c3433dea8532a0bb1879e58eb92a5d9992caf46072a85";
const REQUEST_UUID = "082ecf32-e8ef-4f53-bb49-9f59902db37e";

describe("sourceExplorer (Agglayer send Midenscan link)", () => {
  it("deep-links the real Miden tx hash", () => {
    const link = sourceExplorer(agglayerSend({ midenTxId: REAL_TX }));
    expect(link.available).toBe(true);
    expect(link.href).toBe(`https://testnet.midenscan.com/tx/${REAL_TX}`);
  });

  it("never links a wallet-adapter request UUID (the broken-link bug)", () => {
    const link = sourceExplorer(agglayerSend({ midenTxId: REQUEST_UUID }));
    expect(link.available).toBe(false);
    expect(link.href).toBeUndefined();
  });
});

const EVM_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const MIDEN_ADDRESS = "mcst1q........................abcdef";

describe("evmWalletIdentity (issue #54 chain-specific identity)", () => {
  it("names the Sepolia wallet when disconnected, not a generic label", () => {
    const id = evmWalletIdentity({
      connected: false,
      wrongNetwork: false,
      address: "",
    });
    expect(id.pillLabel).toBe("Sepolia wallet");
    expect(id.actionLabel).toBe("Connect Sepolia wallet");
    expect(id.stateText).toBe("Not connected");
    expect(id.state).toBe("idle");
  });

  it("shows a short address and a menu accessible name when connected", () => {
    const id = evmWalletIdentity({
      connected: true,
      wrongNetwork: false,
      address: EVM_ADDRESS,
    });
    expect(id.pillLabel).toBe("0x1234...345678");
    expect(id.stateText).toBe("0x1234...345678");
    expect(id.actionLabel).toBe("Sepolia wallet menu");
    expect(id.state).toBe("connected");
  });

  it("surfaces a wrong-network state inline when connected off Sepolia", () => {
    const id = evmWalletIdentity({
      connected: true,
      wrongNetwork: true,
      address: EVM_ADDRESS,
    });
    expect(id.stateText).toBe("Wrong network");
    expect(id.state).toBe("wrong-network");
  });
});

describe("midenWalletIdentity (issue #54 chain-specific identity)", () => {
  it("names the Miden wallet when connectable", () => {
    const id = midenWalletIdentity({
      connecting: false,
      connected: false,
      ready: true,
      address: "",
    });
    expect(id.pillLabel).toBe("Miden wallet");
    expect(id.actionLabel).toBe("Connect Miden wallet");
    expect(id.state).toBe("idle");
  });

  it("uses an explicit unavailable state, not a generic install label", () => {
    const id = midenWalletIdentity({
      connecting: false,
      connected: false,
      ready: false,
      address: "",
    });
    expect(id.pillLabel).toBe("MidenFi not installed");
    expect(id.stateText).toBe("Not installed");
    expect(id.state).toBe("unavailable");
  });

  it("reports connecting and connected states", () => {
    const connecting = midenWalletIdentity({
      connecting: true,
      connected: false,
      ready: true,
      address: "",
    });
    expect(connecting.stateText).toBe("Connecting…");
    expect(connecting.state).toBe("connecting");

    const connected = midenWalletIdentity({
      connecting: false,
      connected: true,
      ready: true,
      address: MIDEN_ADDRESS,
    });
    expect(connected.pillLabel).toBe(connected.stateText);
    expect(connected.state).toBe("connected");
    expect(connected.actionLabel).toBe("Miden wallet menu");
  });
});
