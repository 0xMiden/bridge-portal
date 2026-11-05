import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeEventTopics,
  encodeFunctionData, encodeFunctionResult, type Abi } from "viem";
import generated from "./abi/MidenCctpDepositHelper.json";
import { helperAbi } from "./helper-abi";

const compilerAbi = generated as Abi;
const address = "0x1111111111111111111111111111111111111111" as const;
const word = `0x${"12".repeat(32)}` as const;
describe("compiler-owned helper ABI parity", () => {
  it("pins the exact artifact generated from backend 1670643e", () => {
    const bytes = readFileSync(new URL("./abi/MidenCctpDepositHelper.json", import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("237b93bc9629d086e6408754b97e400c9a780de3568bd1976f99059949cd201a");
  });
  it.each(helperAbi)("matches all types, mutability, return values and indexed fields: $name", item => {
    const actual = compilerAbi.find(row => row.type === item.type && "name" in row && row.name === item.name);
    const normalized = (value: unknown) => JSON.parse(JSON.stringify(value), (key, field) => {
      if (key === "name" || key === "internalType") return undefined;
      return (key === "indexed" || key === "anonymous") && field === false ? undefined : field;
    });
    expect(actual).toBeDefined();
    expect(normalized(actual)).toEqual(normalized(item));
  });
  it("decodes minimal-interface calldata through the compiler ABI", () => {
    const args = ["0x123456", "0xabcdef"] as const;
    const data = encodeFunctionData({ abi: helperAbi, functionName: "receiveAndDeposit", args });
    expect(decodeFunctionData({ abi: compilerAbi, data })).toEqual({ functionName: "receiveAndDeposit", args });
  });
  it.each(["messageTransmitter", "tokenMessenger", "usdc", "xReserve", "midenDomain", "expectedMidenFaucet"] as const)(
    "decodes compiler return values through the minimal getter %s", functionName => {
      const result = functionName === "midenDomain" ? 10007 : functionName === "expectedMidenFaucet" ? word : address;
      const data = encodeFunctionResult({ abi: compilerAbi, functionName, result });
      expect(decodeFunctionResult({ abi: helperAbi, functionName, data })).toEqual(result);
    },
  );
  it("decodes exact compiler event topics and data through the observer interface", () => {
    const topics = encodeEventTopics({ abi: compilerAbi, eventName: "DepositedToMiden", args: { sourceDomain: 5, cctpNonce: word, midenRecipient: word } });
    const data = encodeAbiParameters([{ type: "uint256" }], [999990n]);
    expect(decodeEventLog({ abi: helperAbi, topics: topics as [typeof word, ...typeof word[]], data })).toEqual({
      eventName: "DepositedToMiden", args: { sourceDomain: 5, cctpNonce: word, midenRecipient: word, amount: 999990n },
    });
  });
});
