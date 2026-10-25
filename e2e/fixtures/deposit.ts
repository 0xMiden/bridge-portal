import { expect, type Page } from "@playwright/test";
import { decodeFunctionData, parseAbi, type Hex } from "viem";
import { EVM_ADDRESS, respondToWallet, SOURCE_TX, type WalletRequest } from "./wallets";

// Independent ABI/values at the extension boundary, not buildDepositTransaction.
export function expectAgglayerDeposit(request: WalletRequest, amount = 10_000_000_000_000_000n) {
  expect(request.wallet).toBe("evm");
  expect(request.method).toBe("eth_sendTransaction");
  expect(request.params).toHaveLength(1);
  const tx = request.params[0] as { from: string; to: string; chainId: Hex; value: Hex; data: Hex };
  expect(tx.from.toLowerCase()).toBe(EVM_ADDRESS.toLowerCase());
  expect(tx.to.toLowerCase()).toBe("0x528e26b25a34a4a5d0dbda1d57d318153d2ed582");
  expect(BigInt(tx.chainId)).toBe(11155111n);
  expect(BigInt(tx.value)).toBe(amount);
  const decoded = decodeFunctionData({
    abi: parseAbi(["function bridgeAsset(uint32 destinationNetwork, address destinationAddress, uint256 amount, address token, bool forceUpdateGlobalExitRoot, bytes permitData) payable"]),
    data: tx.data,
  });
  expect(decoded.functionName).toBe("bridgeAsset");
  expect(decoded.args.map(value => typeof value === "string" ? value.toLowerCase() : value)).toEqual([
    73, "0x000000002d45Bdf6E85b898144227De68b46C100".toLowerCase(), amount,
    "0x0000000000000000000000000000000000000000", true, "0x",
  ]);
}

export function acceptAgglayerDeposit(page: Page, amount?: bigint) {
  respondToWallet(page, request => {
    expectAgglayerDeposit(request, amount);
    return { result: SOURCE_TX };
  });
}
