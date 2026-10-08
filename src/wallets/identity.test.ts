import { describe, expect, it } from "vitest";
import { evmWalletIdentity, midenWalletIdentity } from "./identity";

const EVM_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const MIDEN_ADDRESS = "mcst1q........................abcdef";

describe("evmWalletIdentity (issue #54 chain-specific identity)", () => {
  it("names the Sepolia wallet when disconnected, not a generic label", () => {
    const id = evmWalletIdentity({
      connected: false,
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
      address: EVM_ADDRESS,
    });
    expect(id.pillLabel).toBe("0x1234...345678");
    expect(id.stateText).toBe("0x1234...345678");
    expect(id.actionLabel).toBe("Sepolia wallet menu");
    expect(id.state).toBe("connected");
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
    expect(id.pillLabel).toBe("Bread");
    expect(id.actionLabel).toBe("Connect Bread wallet");
    expect(id.state).toBe("idle");
  });

  it("uses an explicit unavailable state, not a generic install label", () => {
    const id = midenWalletIdentity({
      connecting: false,
      connected: false,
      ready: false,
      address: "",
    });
    expect(id.pillLabel).toBe("Bread not installed");
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
    expect(connected.actionLabel).toBe("Bread wallet menu");
  });
});
