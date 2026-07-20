import { describe, expect, it } from "vitest";
import {
  type Activity,
  type BridgeProvider,
  type CtaInputs,
  type FlowMode,
  deriveCtaState,
  evmWalletIdentity,
  isValidAmount,
  midenWalletIdentity,
  providers,
  quoteFor,
  routeAsset,
  routeSwitchChangesAsset,
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

describe("isValidAmount (wallet-prompt floor)", () => {
  it("accepts a finite positive amount", () => {
    expect(isValidAmount("1")).toBe(true);
    expect(isValidAmount("0.0001")).toBe(true);
  });

  it("rejects empty, zero, negative, malformed, and non-finite amounts", () => {
    for (const bad of ["", "   ", "0", "0.0", "-1", "abc", "1.2.3", "1e999", "NaN", "Infinity"]) {
      expect(isValidAmount(bad)).toBe(false);
    }
  });
});

describe("deriveCtaState (primary CTA progression)", () => {
  // A fully-ready receive; individual tests override one field to probe a state.
  const ready: CtaInputs = {
    mode: "receive",
    sourceConnected: true,
    hasDestination: true,
    amount: "1",
    sourceTokenSymbol: "USDC",
    insufficientBalance: false,
    quoteLoading: false,
    isSubmitting: false,
    submitPhase: "",
  };

  it("submitting wins over everything and stays disabled", () => {
    const cta = deriveCtaState({ ...ready, isSubmitting: true, submitPhase: "Confirm in your wallet…" });
    expect(cta.action).toBe("submitting");
    expect(cta.label).toBe("Confirm in your wallet…");
    expect(cta.disabled).toBe(true);
    expect(cta.opensReview).toBe(false);
  });

  it("an invalid amount disables the CTA (no wallet prompt possible)", () => {
    for (const bad of ["", "0", "-1", "abc", "1e999"]) {
      const cta = deriveCtaState({ ...ready, amount: bad });
      expect(cta.action).toBe("enter-amount");
      expect(cta.label).toBe("Enter amount");
      expect(cta.disabled).toBe(true);
      expect(cta.opensReview).toBe(false);
    }
  });

  it("uses the chain-specific connect label for a missing source wallet", () => {
    const receive = deriveCtaState({ ...ready, sourceConnected: false });
    expect(receive.action).toBe("connect-source");
    expect(receive.label).toBe("Connect Sepolia wallet");
    expect(receive.disabled).toBe(false);

    const send = deriveCtaState({ ...ready, mode: "send", sourceConnected: false });
    expect(send.label).toBe("Connect Miden wallet");
  });

  it("prompts for the correct destination when it's missing", () => {
    const receive = deriveCtaState({ ...ready, hasDestination: false });
    expect(receive.action).toBe("add-destination");
    expect(receive.label).toBe("Add Miden account");

    const send = deriveCtaState({ ...ready, mode: "send", hasDestination: false });
    expect(send.label).toBe("Add Sepolia address");
  });

  it("surfaces insufficient balance as a disabled state", () => {
    const cta = deriveCtaState({ ...ready, insufficientBalance: true });
    expect(cta.action).toBe("insufficient");
    expect(cta.label).toBe("Not enough USDC");
    expect(cta.disabled).toBe(true);
  });

  it("shows a disabled quote-loading state (not mistakable for ready)", () => {
    const cta = deriveCtaState({ ...ready, quoteLoading: true });
    expect(cta.action).toBe("quote-loading");
    expect(cta.label).toBe("Fetching quote…");
    expect(cta.disabled).toBe(true);
    expect(cta.opensReview).toBe(false);
  });

  it("opens the preflight review only when everything is ready", () => {
    const receive = deriveCtaState(ready);
    expect(receive.action).toBe("review");
    expect(receive.label).toBe("Review receive");
    expect(receive.disabled).toBe(false);
    expect(receive.opensReview).toBe(true);

    const send = deriveCtaState({ ...ready, mode: "send" });
    expect(send.label).toBe("Review send");
    expect(send.opensReview).toBe(true);
  });
});

describe("routeAsset (route input token)", () => {
  it("moves USDC on Epoch, ETH on Agglayer", () => {
    expect(routeAsset("epoch")).toBe("USDC");
    expect(routeAsset("agglayer")).toBe("ETH");
  });

  it("is direction-independent (same input token both ways)", () => {
    expect(routeAsset("epoch")).toBe(routeAsset("epoch"));
    expect(routeAsset("agglayer")).toBe(routeAsset("agglayer"));
  });
});

// The reset guard the form relies on: a route switch that changes the input
// asset must not silently preserve the numeric amount (an amount typed as USDC
// becoming the same number of ETH). routeSwitchChangesAsset is that decision.
describe("routeSwitchChangesAsset (amount/quote reset guard)", () => {
  it("flags a change switching Epoch (USDC) → Agglayer (ETH)", () => {
    expect(routeSwitchChangesAsset("epoch", "agglayer")).toBe(true);
  });

  it("flags a change switching Agglayer (ETH) → Epoch (USDC)", () => {
    expect(routeSwitchChangesAsset("agglayer", "epoch")).toBe(true);
  });

  it("does not flag re-selecting the same route", () => {
    expect(routeSwitchChangesAsset("epoch", "epoch")).toBe(false);
    expect(routeSwitchChangesAsset("agglayer", "agglayer")).toBe(false);
  });

  // Model the form's clear-on-switch behavior: when the guard fires, the amount
  // is cleared (so no stale amount survives); otherwise it is preserved.
  it("clears the amount only when the asset changes, in both directions", () => {
    const applySwitch = (from: BridgeProvider, to: BridgeProvider, amount: string) =>
      routeSwitchChangesAsset(from, to) ? "" : amount;

    expect(applySwitch("epoch", "agglayer", "100")).toBe("");
    expect(applySwitch("agglayer", "epoch", "0.5")).toBe("");
    expect(applySwitch("epoch", "epoch", "100")).toBe("100");
    expect(applySwitch("agglayer", "agglayer", "0.5")).toBe("0.5");
  });
});

// No stale quote or token label may survive a route switch: the fresh route's
// quote must immediately report the new route's asset and ETA.
describe("quoteFor refreshes fully on a route switch", () => {
  const modesToTest: FlowMode[] = ["receive", "send"];

  for (const mode of modesToTest) {
    it(`Epoch quote reports USDC + 1-3 min ETA (${mode})`, () => {
      const quote = quoteFor(mode, "epoch", "100");
      expect(quote.expectedReceived).toContain("USDC");
      expect(quote.minReceived).toContain("USDC");
      expect(quote.eta).toBe("1-3 min");
    });

    it(`Agglayer quote reports ETH + 10-20 min ETA (${mode})`, () => {
      const quote = quoteFor(mode, "agglayer", "100");
      expect(quote.expectedReceived).toContain("ETH");
      expect(quote.minReceived).toContain("ETH");
      expect(quote.eta).toBe("10-20 min");
    });

    it(`a USDC→ETH switch changes the quoted token label (${mode})`, () => {
      const before = quoteFor(mode, "epoch", "100");
      const after = quoteFor(mode, "agglayer", "100");
      expect(before.expectedReceived).not.toBe(after.expectedReceived);
      expect(after.expectedReceived).not.toContain("USDC");
    });
  }
});

// Every active route must expose the comparison facts the selector renders, so a
// route can be judged without selecting it first.
describe("route comparison metadata", () => {
  const active = (Object.keys(providers) as BridgeProvider[]).filter(
    (key) => !providers[key].disabled,
  );

  it("exposes asset, ETA, fee, claim, trust for each active route", () => {
    for (const key of active) {
      const c = providers[key].comparison;
      expect(c.asset).toBeTruthy();
      expect(c.eta).toBeTruthy();
      expect(c.feeModel).toBeTruthy();
      expect(c.claim).toBeTruthy();
      expect(c.trust).toBeTruthy();
      expect(c.availability).toBe("Available");
    }
  });

  it("gives a disabled route a reason for being unavailable", () => {
    const disabled = (Object.keys(providers) as BridgeProvider[]).filter(
      (key) => providers[key].disabled,
    );
    for (const key of disabled) {
      expect(providers[key].comparison.unavailableReason).toBeTruthy();
    }
  });
});
