import { expect, it } from "vitest";
import { isBitcoinAddress } from "./address";

// Independent BIP-350 vectors plus Base58Check mainnet/testnet addresses.
it.each([
  "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
  "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
  "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4",
  "bc1q622ascprdhkprwunjwwa3dsn5scfx7dfy8j2j7",
  "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
])("accepts a checksummed mainnet address: %s", address => {
  expect(isBitcoinAddress(address)).toBe(true);
});

it.each([
  "",
  "1BoatSLRHtKNngkdXEeobR76b53LETtpyX",
  "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn",
  "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7",
  "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd",
  "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh",
  "bc1pw5dgrnzv",
  "BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P",
  "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v07qwwzcrf",
  "BC1SW50QGDZ25J", // Future witness versions are outside this release's scope.
  "bC1q622ascprdhkprwunjwwa3dsn5scfx7dfy8j2j7",
  "bitcoin:1BoatSLRHtKNngkdXEeobR76b53LETtpyT?amount=1",
])("rejects malformed, unsupported and non-mainnet addresses: %s", address => {
  expect(isBitcoinAddress(address)).toBe(false);
});
