import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { decodeFunctionData, parseAbi } from "viem";

// Feasible supplement when this machine cannot launch a browser. This never
// reports browser acceptance and never replaces the default Playwright suite.
const runRoot = process.env.HELPER_BROWSER_RUN_ROOT;
const port = Number(process.env.HELPER_BROWSER_PORT);
const control = process.env.HELPER_FIXTURE_CONTROL_URL;
assert(runRoot && Number.isInteger(port) && control && new URL(control).hostname === "127.0.0.1");
const marker = JSON.parse(await fs.readFile(".helper-fixture.json", "utf8"));
assert.equal(marker.sourceRoot, process.cwd()); assert.equal(marker.runRoot, runRoot); assert.equal(marker.testOnly, true);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { stdio: "inherit" });
const results = [];
const record = name => { results.push({ name, result: "PASS" }); console.log(`PASS ${name}`); };
const [deployment] = JSON.parse(await fs.readFile("e2e/fixtures/cctp-helper-public.json", "utf8"));
const idl = JSON.parse(await fs.readFile("src/bridge/providers/xreserve/idl/token-messenger-minter-v2.json", "utf8"));
const golden = JSON.parse(await fs.readFile("e2e/helper/solana-golden.json", "utf8"));
async function post(url, data, expected = 200) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data), signal: AbortSignal.timeout(15_000) });
  const body = await response.json(); assert.equal(response.status, expected, JSON.stringify(body)); return body;
}
async function observe(signature, id = deployment.deploymentId) {
  const response = await fetch(`${base}/api/cctp-helper/manual/attestation?deploymentId=${id}&sourceTransaction=${signature}`, { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200); return response.json();
}
async function change(data) { await post(`${control}/scenario`, data); }
async function state() { return (await fetch(`${control}/state`)).json(); }
let rpcId = 0;
const rpc = (method, params, status = 200) => post(`${base}/api/cctp-helper/manual/rpc?deploymentId=${deployment.deploymentId}`, { jsonrpc: "2.0", id: ++rpcId, method, params }, status);
try {
  const deadline = Date.now() + 60_000;
  while (true) {
    try { await fetch(`${base}/api/cctp-helper/manual/quote`, { signal: AbortSignal.timeout(1000) }); break; }
    catch { assert(Date.now() < deadline, "Owned Next server did not start"); await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  await post(`${control}/reset`, {});
  const owner = Keypair.fromSeed(new Uint8Array(32).fill(1)), event = Keypair.fromSeed(new Uint8Array(32).fill(2));
  const input = { deploymentId: deployment.deploymentId, sourceDomain: 5, sourceAccount: owner.publicKey.toBase58(), grossAmount: "1000000", midenRecipient: golden.miden.bytes32 };
  const quote = await post(`${base}/api/cctp-helper/manual/quote`, input);
  assert.equal(quote.maxCctpFee, "10"); assert.equal(quote.minimumNet, "999990"); assert.equal(quote.execution, "manual");
  assert.equal(quote.midenRecipient, golden.miden.bytes32); assert.equal(quote.sourceAccount, owner.publicKey.toBase58());
  assert(!("minimumSponsoredNet" in quote)); record("actual Next quote traverses source state, fee and destination ABI preflight");
  await post(`${base}/api/cctp-helper/manual/quote`, { ...input, rpcUrl: "https://not-allowed.invalid" }, 400);
  await post(`${base}/api/cctp-helper/manual/quote`, { ...input, grossAmount: "0" }, 422);
  await rpc("requestAirdrop", [owner.publicKey.toBase58(), 100], 400);
  await rpc("getMinimumBalanceForRentExemption", [9999, { commitment: "confirmed" }], 400);
  record("HTTP schemas reject arbitrary endpoints, unsafe amounts and unallowlisted RPC requests");
  const accounts = Object.fromEntries(golden.accounts.map((row, index) => [row.name.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), index === 11 ? event.publicKey : new PublicKey(row.address)]));
  const program = new anchor.Program(idl, { publicKey: owner.publicKey });
  const helper = new PublicKey(Buffer.from(deployment.helper.address.slice(2).padStart(64, "0"), "hex"));
  const ix = await program.methods.depositForBurnWithHook({ amount: new anchor.BN(input.grossAmount), destinationDomain: 26,
    mintRecipient: helper, destinationCaller: helper, maxFee: new anchor.BN(quote.maxCctpFee), minFinalityThreshold: 2000,
    hookData: Buffer.from(golden.hook.slice(2), "hex") }).accountsStrict(accounts).instruction();
  const latest = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const tx = new Transaction({ feePayer: owner.publicKey, ...latest.result.value }).add(ix);
  tx.partialSign(event); tx.partialSign(owner); assert(tx.verifySignatures());
  const bytes = tx.serialize().toString("base64");
  const sourceConnection = new Connection(`${base}/api/cctp-helper/manual/rpc?deploymentId=${deployment.deploymentId}`, {
    commitment: "confirmed", disableRetryOnRateLimit: true,
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }),
  });
  // Exercise the real pinned SDK: it omits skipPreflight:false on the wire.
  const signature = await sourceConnection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 0 });
  const ready = await observe(signature);
  assert.equal(ready.state, "ready", JSON.stringify(ready));
  const bundle = ready.bundle;
  assert.equal(bundle.source.midenRecipient, input.midenRecipient); assert.equal(bundle.source.grossAmount, input.grossAmount);
  assert.deepEqual(bundle.source.sourceEventIds, [`solana:${signature}:0:2`]);
  assert.equal(bundle.maxCctpFee, "10"); assert.equal(bundle.feeExecuted, "0"); assert.equal(bundle.netAmount, "1000000");
  const call = decodeFunctionData({ abi: parseAbi(["function receiveAndDeposit(bytes,bytes)"]), data: bundle.call.data });
  assert.equal(call.functionName, "receiveAndDeposit"); assert.deepEqual(call.args, [bundle.message, bundle.attestation]);
  assert.equal(bundle.call.to, deployment.helper.address); assert.equal(bundle.call.value, "0");
  assert.equal(bundle.notice, "A separate transaction on Arc is still required. USDCx has not been delivered.");
  assert(!/signedBytes|secretKey|privateKey|solanaRpc|arcRpc|irisApi/.test(JSON.stringify(bundle)));
  record("actual Next RPC admission, finalized source occurrence, attestation authentication and exact manual calldata");
  await change({ feeBps: "0" });
  assert.equal((await post(`${base}/api/cctp-helper/manual/quote`, input)).maxCctpFee, "0");
  record("ordinary fee recipient admits a current zero quote without changing saved positive-cap bytes");
  for (const feeBps of ["0.1", "0"]) {
    await change({ feeBps, feeRecipient: deployment.helper.address });
    await post(`${base}/api/cctp-helper/manual/quote`, input, 503);
    await rpc("sendTransaction", [bytes, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }], 503);
    await assert.rejects(sourceConnection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 0 }));
    await rpc("simulateTransaction", [bytes, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" }], 503);
    assert.equal((await state()).sends.length, 1);
    record(`helper fee recipient blocks quote, readiness and saved positive-cap broadcast with current fee ${feeBps}`);
  }
  const historicalZero = await observe(signature);
  assert.equal(historicalZero.state, "ready"); assert.equal(historicalZero.bundle.feeExecuted, "0");
  record("historical finalized zero-fee export survives self fee recipient through full helper simulation");
  await change({ executedFee: "1" });
  assert.equal((await observe(signature)).state, "needs_attention");
  record("historical positive fee with self recipient fails full helper simulation");
  await change({ executedFee: "0", feeRecipient: `0x${"88".repeat(20)}` });
  for (const feeRecipientResult of ["error", "malformed"]) {
    await change({ feeRecipientResult });
    await post(`${base}/api/cctp-helper/manual/quote`, input, 503);
    await rpc("sendTransaction", [bytes, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }], 503);
    assert.equal((await state()).sends.length, 1);
    record(`${feeRecipientResult} fee getter blocks new source quote and direct proxy send`);
  }
  await change({ feeRecipientResult: "normal", feeBps: "0.1" });
  for (const mutation of ["source-signature", "source-ambiguous", "source-hook", "source-account", "envelope", "amount", "helper", "hook", "finality", "expiry", "ambiguous", "attestation"]) {
    await change({ mutation }); const result = await observe(signature);
    assert.equal(result.state, "needs_attention", `${mutation}: ${JSON.stringify(result)}`); assert(!result.bundle);
    record(`handler denies ${mutation}`);
  }
  await change({ mutation: "none", helperSimulationFails: true });
  assert.equal((await observe(signature)).state, "needs_attention"); record("full helper simulation failure denies export data");
  await change({ helperSimulationFails: false, finalized: false, expired: true });
  assert.equal((await observe(signature)).state, "pending"); record("unknown expired source does not become conclusive no-burn evidence");
  assert.equal((await observe(signature, "unknown-historical-deployment")).reason, "historical_deployment_unavailable");
  record("unknown historical deployment cannot substitute current configuration");
  assert.equal((await state()).sends.length, 1); record("all handler attacks retain one source broadcast");
  await change({ finalized: true, expired: false });
  assert.equal(await sourceConnection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 0 }), signature);
  const replayed = await state();
  assert.deepEqual(replayed.sends, Array(2).fill({ signature, bytes }));
  for (const call of replayed.calls.filter(call => call.kind === "solana" && call.method === "sendTransaction"))
    assert.deepEqual(call.params[1], { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 });
  record("genuine SDK initial and identical-byte resend reach upstream with normalized explicit false preflight");
  await fs.writeFile(path.join(runRoot, "http-results.json"), JSON.stringify({ state: "passed", browser: "NOT RUN", tests: results, signature, sourceHash: marker.sourceHash }, null, 2));
} finally {
  server.kill("SIGTERM");
  await new Promise(resolve => server.once("exit", resolve));
}
