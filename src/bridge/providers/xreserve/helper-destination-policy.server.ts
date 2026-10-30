import "server-only";
import { parseAbi, zeroAddress, type createPublicClient } from "viem";
import { address, type HelperIdentity } from "../../../config/cctp-helper";

export type DestinationAmounts = { grossAmount: bigint; netAmount: bigint; phase: "source-admission" | "attested" };
type PolicyClient = Pick<ReturnType<typeof createPublicClient>, "readContract">;
const abi = parseAbi([
  "function domain() view returns(uint32)", "function decimals() view returns(uint8)", "function paused() view returns(bool)",
  "function domainWithdrawalsPaused(uint32) view returns(bool)", "function getRemoteDomainDepositor(uint32) view returns(address)",
  "function getRemoteDomainHookExecutor(uint32) view returns(address)", "function gatewayWallet() view returns(address)",
  "function gatewayMinter() view returns(address)", "function isTokenSupported(address) view returns(bool)",
  "function isDenylisted(address) view returns(bool)", "function isBlacklisted(address) view returns(bool)",
  "function allowance(address,address) view returns(uint256)", "function isMinter(address) view returns(bool)",
  "function minterAllowance(address) view returns(uint256)", "function localTokenMessenger() view returns(address)",
  "function feeRecipient() view returns(address)", "function signatureThreshold() view returns(uint256)",
  "function maxMessageBodySize() view returns(uint256)",
]);

async function requirePolicy(checks: Promise<boolean>[]) {
  if ((await Promise.all(checks)).some(value => value !== true))
    throw new Error("Fresh destination bindings, Gateway or native USDC policy prevents this transfer.");
}

/** Runtime identity alone cannot establish that a later source burn remains viable. */
export async function assertManualDestinationPolicy(deployment: HelperIdentity, client: PolicyClient, amounts: DestinationAmounts) {
  if (amounts.grossAmount <= 0n || amounts.netAmount <= 0n || amounts.netAmount > amounts.grossAmount)
    throw new Error("Invalid destination admission amounts.");
  // A finalized zero-fee message never mints a fee. Unrelated current fee policy
  // must not block its recovery; new burns may still execute a positive fee.
  const needsFeeRecipient = amounts.phase === "source-admission" || amounts.grossAmount !== amounts.netAmount;
  const feeRecipient = needsFeeRecipient ? await readFeeRecipient(deployment, client) : undefined;
  await Promise.all([
    assertReserveBindings(deployment, client, amounts.phase), assertGatewayPolicy(deployment, client, amounts),
    assertMintPolicy(deployment, client, amounts), assertPrincipalPolicy(deployment, client, feeRecipient),
  ]);
  if (amounts.phase === "source-admission" && feeRecipient === deployment.helper.address)
    throw new Error("The Circle fee recipient cannot be the helper for a new source burn.");
}

async function readFeeRecipient({ arc }: HelperIdentity, client: PolicyClient) {
  const checked = address.safeParse((await client.readContract({ address: arc.tokenMessenger.address, abi, functionName: "feeRecipient" })).toLowerCase());
  if (!checked.success) throw new Error("The Circle fee recipient is unavailable.");
  return checked.data;
}

async function assertReserveBindings({ arc, miden }: HelperIdentity, client: PolicyClient, phase: DestinationAmounts["phase"]) {
  const reserve = arc.xReserve.address;
  await requirePolicy([
    client.readContract({ address: reserve, abi, functionName: "domain" }).then(value => value === 26),
    client.readContract({ address: arc.usdc.address, abi, functionName: "decimals" }).then(value => value === 6),
    client.readContract({ address: reserve, abi, functionName: "getRemoteDomainDepositor", args: [miden.domain] })
      .then(value => value.toLowerCase() === miden.remoteDomainDepositor),
    client.readContract({ address: reserve, abi, functionName: "getRemoteDomainHookExecutor", args: [miden.domain] })
      .then(value => value.toLowerCase() === zeroAddress),
    ...(phase === "source-admission" ? [
      client.readContract({ address: reserve, abi, functionName: "domainWithdrawalsPaused", args: [miden.domain] }).then(value => !value),
      client.readContract({ address: reserve, abi, functionName: "gatewayMinter" }).then(value => value.toLowerCase() === arc.gatewayMinter.address),
    ] : []),
    client.readContract({ address: reserve, abi, functionName: "gatewayWallet" }).then(value => value.toLowerCase() === arc.gatewayWallet.address),
  ]);
}

async function assertGatewayPolicy({ arc, miden }: HelperIdentity, client: PolicyClient, amounts: DestinationAmounts) {
  const gateway = arc.gatewayWallet.address;
  await requirePolicy([
    ...(amounts.phase === "source-admission" ? [gateway, arc.gatewayMinter.address] : [gateway]).map(target => client.readContract({ address: target, abi, functionName: "paused" }).then(value => !value)),
    client.readContract({ address: gateway, abi, functionName: "isTokenSupported", args: [arc.usdc.address] }),
    client.readContract({ address: arc.usdc.address, abi, functionName: "allowance", args: [arc.xReserve.address, gateway] }).then(value => value >= amounts.netAmount),
    // Gateway sees xReserve as caller and RemoteDomainDepositor as beneficiary.
    ...[arc.xReserve.address, miden.remoteDomainDepositor].map(principal =>
      client.readContract({ address: gateway, abi, functionName: "isDenylisted", args: [principal] }).then(value => !value)),
  ]);
}

async function assertMintPolicy({ arc }: HelperIdentity, client: PolicyClient, amounts: DestinationAmounts) {
  await requirePolicy([
    client.readContract({ address: arc.tokenMinter.address, abi, functionName: "localTokenMessenger" })
      .then(value => value.toLowerCase() === arc.tokenMessenger.address),
    client.readContract({ address: arc.usdc.address, abi, functionName: "isMinter", args: [arc.tokenMinter.address] }),
    // Native USDC mints principal and fee separately, consuming the gross allowance.
    client.readContract({ address: arc.usdc.address, abi, functionName: "minterAllowance", args: [arc.tokenMinter.address] }).then(value => value >= amounts.grossAmount),
    client.readContract({ address: arc.messageTransmitter.address, abi, functionName: "signatureThreshold" }).then(value => value > 0n),
    ...(amounts.phase === "source-admission" ? [
      client.readContract({ address: arc.messageTransmitter.address, abi, functionName: "maxMessageBodySize" }).then(value => value >= 292n),
    ] : []),
  ]);
}

async function assertPrincipalPolicy({ arc, helper, miden }: HelperIdentity, client: PolicyClient, feeRecipient?: `0x${string}`) {
  const principals = [arc.tokenMinter.address, arc.gatewayWallet.address, helper.address, arc.xReserve.address, miden.remoteDomainDepositor, ...(feeRecipient ? [feeRecipient] : [])];
  await requirePolicy(principals.map(principal =>
    client.readContract({ address: arc.usdc.address, abi, functionName: "isBlacklisted", args: [principal] }).then(value => !value)));
}
