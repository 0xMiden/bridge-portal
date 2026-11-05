import { configKey } from "../../../config/bridge-config";
import { getEvmHelperDeployment, assertHelperConfig } from "../../../config/cctp-evm-helper";
import { createWalletClient, custom, formatUnits, type Hex } from "viem";
import type { QuoteRequest, QuoteResult } from "../../core/quote";
import type { SubmissionContext } from "../../core/submission";
import { prepareDepositWallet } from "../../evm/deposit-wallet";
import { ensureUsdcApproval } from "./approval";
import { arcRecipient, parseArcAmount } from "./deposit-terms";
import { evmNetworks } from "../../../config/evm-networks";
import { evmManualQuoteSchema, evmManualAuthorizationSchema, type EvmManualAuthorization, type EvmHelperActivity } from "./helper-evm-types";
import { evmHelperBurnCall, evmHelperCallData, evmHelperIntent } from "./helper-evm-call";
import { EvmHelperJournal } from "./helper-evm-journal";

async function evmManualJson(path: string, input: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/cctp-helper/evm/${path}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(input), cache: "no-store", signal: signal ?? AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("Fresh manual CCTP validation is unavailable. Do not burn again if your wallet was already invoked.");
  return response.json() as Promise<unknown>;
}
export async function quoteEvmManualTransfer(input: QuoteRequest, signal: AbortSignal): Promise<QuoteResult> {
  const d = input.route.evmHelperDeployment;
  if (input.route.disabled || !d?.enabled) throw new Error("This source has no qualified manual Arc deployment.");
  assertHelperConfig(d, input.route.recovery);
  const request = { deploymentId: d.deploymentId, sourceAccount: input.evmAddress.toLowerCase(),
    grossAmount: parseArcAmount(input.amount).toString(), midenRecipient: arcRecipient(input.midenAccount) };
  const quote = evmManualQuoteSchema.parse(await evmManualJson("quote", request, signal));
  for (const [key, value] of Object.entries(request)) if (quote[key as keyof typeof request] !== value) throw new Error("Manual quote changed.");
  return { kind: "cctp-helper-evm", authorization: evmManualAuthorizationSchema.parse({ ...quote, deployment: d, finality: 2000 }),
    received: formatUnits(BigInt(quote.minimumNet), 6), fee: formatUnits(BigInt(quote.maxCctpFee), 6), validity: { kind: "provider" } };
}
export async function refreshEvmManualQuote(auth: EvmManualAuthorization) {
  const { deploymentId, sourceAccount, grossAmount, midenRecipient } = auth;
  const fresh = evmManualQuoteSchema.parse(await evmManualJson("quote", { deploymentId, sourceAccount, grossAmount, midenRecipient }));
  for (const field of ["deploymentId", "sourceAccount", "grossAmount", "midenRecipient", "maxCctpFee", "minimumNet"] as const)
    if (fresh[field] !== auth[field]) throw new Error("Source terms or fee changed. Review again before invoking the wallet.");
}
function reviewedEvmSource(context: SubmissionContext) {
  const auth = context.input.quote?.kind === "cctp-helper-evm" ? context.input.quote.authorization : undefined;
  if (!auth || !context.input.helperAttemptId || !context.saveEvmHelperDurably) throw new Error("Review the EVM source attempt again.");
  const current = getEvmHelperDeployment(auth.deploymentId, true);
  if (configKey(current) !== configKey(auth.deployment) || configKey(current) !== configKey(context.route.evmHelperDeployment)) throw new Error("Reviewed deployment changed.");
  if (auth.sourceAccount !== context.input.evmAddress.toLowerCase() || auth.grossAmount !== parseArcAmount(context.input.amount).toString() ||
    auth.midenRecipient !== arcRecipient(context.input.midenAccount)) throw new Error("Reviewed EVM source terms changed.");
  return { auth, attemptId: context.input.helperAttemptId, save: context.saveEvmHelperDurably };
}
export async function submitEvmManualHelper(context: SubmissionContext) {
  const review = reviewedEvmSource(context), { auth } = review;
  const journal = new EvmHelperJournal(), intent = evmHelperIntent(auth);
  journal.assertNew(review.attemptId, intent);
  const provider = context.input.evmWallet.provider;
  if (!provider) throw new Error("Connect your source EVM wallet.");
  const connection = await prepareDepositWallet(auth.deployment.source.network, provider, auth.sourceAccount);
  await refreshEvmManualQuote(auth);
  context.input.assertCurrentWallets?.();
  const s = auth.deployment.source;
  await ensureUsdcApproval({ ...connection, network: s.network, account: auth.sourceAccount, token: s.usdc.address,
    spender: s.tokenMessenger.address, amount: BigInt(auth.grossAmount), onPhase: () => context.phase("Approve native USDC for Circle in your source wallet…") });
  const call = evmHelperBurnCall(auth);
  const simulation = await connection.client.simulateContract(call);
  const [startBlock, requestedNonce] = await Promise.all([connection.client.getBlockNumber({ cacheTime: 0 }),
    connection.client.getTransactionCount({ address: auth.sourceAccount, blockTag: "pending" })]);
  await refreshEvmManualQuote(auth);
  await assertSourceGasFunding(connection.client, auth);
  await connection.assertWallet(); context.input.assertCurrentWallets?.();
  const row: EvmHelperActivity = { schemaVersion: 1, runtime: "evm", authorization: auth, attemptId: review.attemptId, intent,
    recovery: context.route.recovery, stage: "wallet_pending", startBlock: startBlock.toString(), requestedNonce, callData: evmHelperCallData(auth) };
  const save = (next: EvmHelperActivity) => { journal.save(next); review.save({ cctpEvmHelper: next,
    evmAddress: auth.sourceAccount, midenAccount: context.input.midenAccount, destination: context.input.midenAccount,
    sourceTxHash: next.hash, receivedAmount: formatUnits(BigInt(auth.minimumNet), 6) }); };
  save(row); // Durable evidence precedes the only wallet invocation. There are no signed bytes to resend.
  context.phase("Confirm the irreversible USDC burn in your source wallet…");
  const wallet = createWalletClient({ chain: evmNetworks[s.network], transport: custom(provider, { retryCount: 0 }) });
  await sendEvmSourceOnce(() => wallet.writeContract({ ...simulation.request, nonce: requestedNonce }), row, save);
}
/** No wallet retry, including rejection/timeouts: only verified source evidence can resolve uncertainty. */
export async function sendEvmSourceOnce(send: () => Promise<Hex>, row: EvmHelperActivity, save: (row: EvmHelperActivity) => void) {
  let hash: Hex;
  try { hash = await send(); }
  catch (error) {
    save({ ...row, stage: "source_unknown", reason: "Wallet response is unresolved. Recover this attempt; do not invoke the wallet again." });
    throw error;
  }
  save({ ...row, hash: hash.toLowerCase() as Hex, hashOrigin: "wallet", stage: "source_unknown" });
}
export { evmManualJson };

/** Check the known execution-gas floor; the source wallet still reviews its complete fee estimate. */
export async function assertSourceGasFunding(client: Pick<import("viem").PublicClient, "getBalance" | "estimateContractGas" | "getGasPrice">, auth: EvmManualAuthorization) {
  const [balance, gas, price] = await Promise.all([client.getBalance({ address: auth.sourceAccount }),
    client.estimateContractGas(evmHelperBurnCall(auth)), client.getGasPrice()]);
  if (balance === 0n || balance < gas * price) throw new Error(`Insufficient ${evmNetworks[auth.deployment.source.network].nativeCurrency.symbol} for source execution gas. No burn request was sent.`);
}
