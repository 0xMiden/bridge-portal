import { BaseError, createPublicClient, custom, erc20Abi } from "viem";
import { expect, it } from "vitest";
import { errorMessage } from "./wallet-errors";

const unavailable = "Base Sepolia RPC is temporarily unavailable. Please retry shortly.";
const rpcError = new BaseError("Missing or invalid parameters.", {
  details: unavailable,
  metaMessages: [`Request body: {"data":"0x${"ab".repeat(2000)}"}`],
});

it.each([
  ["wrapped RPC outage", new BaseError(rpcError.shortMessage, { cause: rpcError }), unavailable],
  ["serialized RPC outage", rpcError.message.replace(/\n/g, " "), unavailable],
  ["contract failure", new BaseError("The contract rejected this transfer.", {
    metaMessages: [`Contract Call: data: 0x${"ab".repeat(2000)}`],
  }), "The contract rejected this transfer."],
  ["validation", new Error("Not enough USDC to cover the amount and Circle fee."),
    "Not enough USDC to cover the amount and Circle fee."],
  ["wallet cancellation", { code: 4001 }, "You cancelled the request in your wallet."],
  ["unknown error", undefined, "Something went wrong. Try again."],
])("shows an actionable message without diagnostic dumps for %s", (_label, error, expected) => {
  expect(errorMessage(error)).toBe(expected);
});

it("bounds unfamiliar provider messages without dropping their explanation", () => {
  const message = errorMessage(new Error(`Provider unavailable: ${"x".repeat(1000)}`));
  expect(message).toMatch(/^Provider unavailable:/);
  expect(message.length).toBeLessThanOrEqual(280);
});

it.each(["Ethereum", "Arc", "Base", "Arbitrum", "Sepolia", "Arc Testnet", "Base Sepolia", "Arbitrum Sepolia"])(
  "preserves %s retry guidance through viem contract errors and serialization", async (network) => {
    const unavailable = `${network} RPC is temporarily unavailable. Please retry shortly.`;
    const client = createPublicClient({
      transport: custom({ request: async () => {
        throw Object.assign(new Error(unavailable), { code: -32002 });
      } }, { retryCount: 0 }),
    });
    const error = await client.readContract({
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      abi: erc20Abi,
      functionName: "balanceOf",
      args: ["0x0000000000000000000000000000000000000001"],
    }).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(errorMessage(error)).toBe(unavailable);
    expect(errorMessage((error as Error).message.replace(/\n/g, " "))).toBe(unavailable);
  },
);
