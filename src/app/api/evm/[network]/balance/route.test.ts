import { beforeEach, expect, it, vi } from "vitest";
import { evmRpc } from "../../../../../bridge/evm/rpc.server";
import { GET } from "./route";

vi.mock("../../../../../bridge/evm/rpc.server", () => ({ evmRpc: vi.fn() }));
const rpc = vi.mocked(evmRpc);
const address = "0x1111111111111111111111111111111111111111";
const token = "0x3600000000000000000000000000000000000000";
const read = (network: string, query = `address=${address}`) => GET(
  new Request(`http://localhost/api/evm/${network}/balance?${query}`),
  { params: Promise.resolve({ network }) },
);
beforeEach(() => rpc.mockReset());

it.each(["sepolia", "arc-testnet", "base-sepolia", "arbitrum-sepolia"])("reads native %s balances on the requested chain", async (network) => {
  rpc.mockResolvedValue("0xde0b6b3a7640000");
  expect(await (await read(network)).json()).toEqual({ balanceRaw: "1000000000000000000", balance: "1" });
  expect(rpc).toHaveBeenCalledWith(network, "eth_getBalance", [address, "latest"]);
});
it.each([6, 18])("formats ERC-20 balances using %i decimals rather than native units", async (decimals) => {
  rpc.mockResolvedValue("0xf4240");
  expect(await (await read("arc-testnet", `address=${address}&token=${token}&decimals=${decimals}`)).json())
    .toEqual({ balanceRaw: "1000000", balance: decimals === 6 ? "1" : "0.000000000001" });
  expect(rpc).toHaveBeenCalledWith("arc-testnet", "eth_call", [{
    to: token, data: `0x70a08231${address.slice(2).padStart(64, "0")}`,
  }, "latest"]);
});
it("rejects unknown networks and invalid token requests instead of returning a native balance", async () => {
  expect((await read("mainnet")).status).toBe(400);
  for (const query of ["address=nope", `address=${address}&token=bad`, `address=${address}&token=${token}&decimals=1.5`])
    expect((await read("sepolia", query)).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it("reports unavailable RPC separately from a zero balance", async () => {
  rpc.mockRejectedValueOnce(new Error("offline"));
  expect((await read("sepolia")).status).toBe(502);
  rpc.mockResolvedValueOnce("0x0");
  expect(await (await read("sepolia")).json()).toEqual({ balanceRaw: "0", balance: "0" });
});
