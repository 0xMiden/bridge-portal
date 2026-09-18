import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/sepolia-rpc", () => ({
  sepoliaRpc: vi.fn(),
}));

import { sepoliaRpc } from "../../../lib/sepolia-rpc";
import { GET } from "./route";

const rpc = vi.mocked(sepoliaRpc);

describe("GET /api/sepolia/balance", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("rejects a non-address with 400", async () => {
    const res = await GET(new Request("http://localhost/api/sepolia/balance?address=nope"));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns native ETH when no token is given", async () => {
    rpc.mockResolvedValue("0xde0b6b3a7640000");
    const res = await GET(
      new Request(
        "http://localhost/api/sepolia/balance?address=0x1111111111111111111111111111111111111111",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balanceEth).toBe("1");
    expect(rpc).toHaveBeenCalledWith("eth_getBalance", [
      "0x1111111111111111111111111111111111111111",
      "latest",
    ]);
  });

  it("maps RPC failures to 502", async () => {
    rpc.mockRejectedValue(new Error("Sepolia RPC returned 502."));
    const res = await GET(
      new Request(
        "http://localhost/api/sepolia/balance?address=0x1111111111111111111111111111111111111111",
      ),
    );
    expect(res.status).toBe(502);
  });
});
