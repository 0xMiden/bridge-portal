import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, MintLayout, AccountLayout, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { decodeFunctionData, encodeFunctionResult, keccak256, parseAbi, recoverAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const { BN, Program, utils } = anchor;
const owner = Keypair.fromSeed(new Uint8Array(32).fill(1));
const attester = privateKeyToAccount(`0x${"03".repeat(32)}`);
const bytes32 = address => Buffer.from(address.slice(2).padStart(64, "0"), "hex");
const uint = (value, size, little = false) => {
  const out = Buffer.from(BigInt(value).toString(16).padStart(size * 2, "0"), "hex");
  assert.equal(out.length, size); return little ? out.reverse() : out;
};
const tag = name => createHash("sha256").update(name).digest().subarray(0, 8);
const abi = parseAbi([
  "function messageTransmitter() view returns (address)", "function tokenMessenger() view returns (address)",
  "function usdc() view returns (address)", "function xReserve() view returns (address)",
  "function midenDomain() view returns (uint32)", "function expectedMidenFaucet() view returns (bytes32)",
  "function receiveAndDeposit(bytes message,bytes attestation)", "function receiveMessage(bytes message,bytes attestation) returns (bool)",
  "function paused() view returns (bool)", "function domainDepositsPaused(uint32) view returns (bool)",
  "function isRemoteDomainRegistered(uint32) view returns (bool)", "function getRemoteToken(uint32,address) view returns (bytes32)",
  "function isTokenSupported(address) view returns (bool)", "function isBlocklisted(uint32,bytes32) view returns (bool)",
  "function isBlacklisted(address) view returns (bool)", "function localDomain() view returns (uint32)",
  "function version() view returns (uint32)", "function messageBodyVersion() view returns (uint32)",
  "function localMessageTransmitter() view returns (address)", "function localMinter() view returns (address)",
  "function remoteTokenMessengers(uint32) view returns (bytes32)", "function getLocalToken(uint32,bytes32) view returns (address)",
  "function feeRecipient() view returns (address)",
  "function domain() view returns (uint32)", "function decimals() view returns (uint8)",
  "function domainWithdrawalsPaused(uint32) view returns (bool)", "function getRemoteDomainDepositor(uint32) view returns (address)",
  "function getRemoteDomainHookExecutor(uint32) view returns (address)", "function gatewayWallet() view returns (address)",
  "function gatewayMinter() view returns (address)", "function isDenylisted(address) view returns (bool)",
  "function allowance(address,address) view returns (uint256)", "function isMinter(address) view returns (bool)",
  "function minterAllowance(address) view returns (uint256)", "function localTokenMessenger() view returns (address)",
  "function signatureThreshold() view returns (uint256)", "function maxMessageBodySize() view returns (uint256)",
]);

/** Synthetic chain transports only. No fetch/network forwarding is implemented. */
export async function startFixtureServices({ fixtureRoot, runRoot }) {
  const [deployment] = JSON.parse(await fs.readFile(path.join(fixtureRoot, "e2e/fixtures/cctp-helper-public.json"), "utf8"));
  const idlBytes = await fs.readFile(path.join(fixtureRoot, "src/bridge/providers/xreserve/idl/token-messenger-minter-v2.json"));
  assert.equal(createHash("sha256").update(idlBytes).digest("hex"), deployment.source.idlHash, "Fixture must use the pinned real Circle IDL.");
  const idl = JSON.parse(idlBytes);
  const golden = JSON.parse(await fs.readFile(path.join(fixtureRoot, "e2e/helper/solana-golden.json"), "utf8"));
  const program = new Program(idl, { publicKey: owner.publicKey });
  const pid = new PublicKey(deployment.source.tokenMessengerProgram), transmitter = new PublicKey(deployment.source.messageTransmitterProgram);
  const mint = new PublicKey(deployment.source.mint), zero = PublicKey.default;
  const pda = (id, ...seeds) => PublicKey.findProgramAddressSync(seeds.map(seed => typeof seed === "string" ? Buffer.from(seed) : seed), id)[0];
  const keys = {
    tokenMessenger: pda(pid, "token_messenger"), messageTransmitter: pda(transmitter, "message_transmitter"),
    remoteTokenMessenger: pda(pid, "remote_token_messenger", "26"), tokenMinter: pda(pid, "token_minter"),
    localToken: pda(pid, "local_token", mint.toBytes()), eventAuthority: pda(pid, "__event_authority"),
    senderAuthority: pda(pid, "sender_authority"), ata: getAssociatedTokenAddressSync(mint, owner.publicKey),
  };
  const scenarioDefaults = { mutation: "none", feeBps: "0.1", sourceMinFee: 0, finalized: true,
    attestationPending: false, sourceSimulationFails: false, helperSimulationFails: false, lostSend: false, expired: false,
    feeRecipient: `0x${"88".repeat(20)}`, feeRecipientResult: "normal", executedFee: "0" };
  let scenario = { ...scenarioDefaults };
  const initialFinalizedSlot = 105;
  let latestSlot = initialFinalizedSlot, finalizedSlot = initialFinalizedSlot;
  let transactions = new Map();
  let calls = [];
  let sends = [];
  let simulations = [];
  const context = value => ({ context: { slot: latestSlot }, value });
  const account = (data, ownerKey, executable = false) => ({ data: [data.toString("base64"), "base64"],
    executable, lamports: 10_000_000, owner: ownerKey.toBase58(), rentEpoch: 0, space: data.length });
  const encoded = async (name, data, ownerKey) => account(await program.coder.accounts.encode(name, data), ownerKey);
  async function sourceAccount(key) {
    if (key === mint.toBase58()) {
      const data = Buffer.alloc(MintLayout.span);
      MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: zero, supply: 10_000_000_000n, decimals: 6,
        isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: zero }, data);
      return account(data, TOKEN_PROGRAM_ID);
    }
    if (key === keys.ata.toBase58()) {
      const data = Buffer.alloc(AccountLayout.span);
      AccountLayout.encode({ mint, owner: owner.publicKey, amount: 1_000_000_000n, delegateOption: 0, delegate: zero,
        state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: zero }, data);
      return account(data, TOKEN_PROGRAM_ID);
    }
    if ([pid.toBase58(), transmitter.toBase58()].includes(key)) return account(Buffer.from([1]), new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"), true);
    if (key === keys.messageTransmitter.toBase58()) return encoded("messageTransmitter", {
      owner: zero, pendingOwner: zero, attesterManager: zero, pauser: zero, paused: false, localDomain: 5, version: 1,
      signatureThreshold: 1, enabledAttesters: [zero], maxMessageBodySize: new BN(4096),
    }, transmitter);
    if (key === keys.tokenMessenger.toBase58()) return encoded("tokenMessenger", {
      denylister: zero, owner: zero, pendingOwner: zero, messageBodyVersion: 1, authorityBump: 1,
      feeRecipient: zero, minFeeController: zero, minFee: scenario.sourceMinFee,
    }, pid);
    if (key === keys.remoteTokenMessenger.toBase58()) return encoded("remoteTokenMessenger", {
      domain: 26, tokenMessenger: new PublicKey(bytes32(deployment.arc.tokenMessenger.address)),
    }, pid);
    if (key === keys.tokenMinter.toBase58()) return encoded("tokenMinter", { tokenController: zero, pauser: zero, paused: false, bump: 1 }, pid);
    if (key === keys.localToken.toBase58()) return encoded("localToken", {
      custody: zero, mint, burnLimitPerMessage: new BN("18446744073709551615"), messagesSent: new BN(0), messagesReceived: new BN(0),
      amountSent: new BN(0), amountReceived: new BN(0), bump: 1, custodyBump: 1,
    }, pid);
    return null;
  }
  function sourceFixture(transaction, occurrenceSlot) {
    assert(transaction.verifySignatures(), "Broadcast must preserve both real Ed25519 signatures.");
    assert.equal(transaction.signatures.length, 2);
    assert.equal(transaction.feePayer.toBase58(), owner.publicKey.toBase58());
    assert.equal(transaction.instructions.length, 1);
    const ix = transaction.instructions[0], data = ix.data;
    assert.equal(ix.programId.toBase58(), pid.toBase58());
    assert.equal(ix.keys.length, 18);
    ix.keys.forEach((key, position) => {
      const expected = golden.accounts[position];
      if (position !== 11) assert.equal(key.pubkey.toBase58(), expected.address, `IDL account ${position}`);
      // Compiled duplicate metas union writable permissions (owner/payer).
      if (expected.isSigner) assert.equal(key.isSigner, true);
      if (expected.isWritable) assert.equal(key.isWritable, true);
    });
    assert.equal(data.subarray(0, 8).toString("hex"), "6ff53e83cc6cdf9b");
    assert.equal(data.length, 164); assert.equal(data.readUInt32LE(16), 26);
    assert.equal(data.readUInt32LE(92), 2000); assert.equal(data.readUInt32LE(96), 64);
    assert(data.subarray(20, 52).equals(bytes32(deployment.helper.address)));
    assert(data.subarray(52, 84).equals(bytes32(deployment.helper.address)));
    assert.equal(data.subarray(100, 132).toString("hex"), uint(1, 32).toString("hex"));
    const amount = data.readBigUInt64LE(8), fee = data.readBigUInt64LE(84), hook = data.subarray(100);
    const burnBody = Buffer.concat([uint(1, 4), mint.toBuffer(), data.subarray(20, 52), uint(amount, 32), owner.publicKey.toBuffer(), uint(fee, 32), uint(0, 32), uint(0, 32), hook]);
    assert.equal(burnBody.length, 292);
    const sourceMessage = Buffer.concat([uint(1, 4), uint(5, 4), uint(26, 4), uint(0, 32), pid.toBuffer(),
      bytes32(deployment.arc.tokenMessenger.address), data.subarray(52, 84), uint(2000, 4), uint(0, 4), burnBody]);
    const event = Buffer.concat([Buffer.from("e445a52e51cb9a1d90fc9192064aa7eb", "hex"), mint.toBuffer(), uint(amount, 8, true),
      owner.publicKey.toBuffer(), data.subarray(20, 52), uint(26, 4, true), bytes32(deployment.arc.tokenMessenger.address),
      data.subarray(52, 84), uint(fee, 8, true), uint(2000, 4, true), uint(hook.length, 4, true), hook]);
    const send = Buffer.concat([tag("global:send_message"), uint(26, 4, true), bytes32(deployment.arc.tokenMessenger.address),
      data.subarray(52, 84), uint(2000, 4, true), uint(burnBody.length, 4, true), burnBody]);
    const compiled = transaction.compileMessage(), accountKeys = compiled.accountKeys.map(key => key.toBase58());
    const index = key => { const found = accountKeys.indexOf(key.toBase58()); assert(found >= 0); return found; };
    const inner = [
      { programIdIndex: index(TOKEN_PROGRAM_ID), accounts: [index(keys.ata)], data: utils.bytes.bs58.encode(Buffer.from([8])), stackHeight: 2 },
      { programIdIndex: index(transmitter), accounts: [owner.publicKey, keys.senderAuthority, keys.messageTransmitter, ix.keys[11].pubkey, pid, zero].map(index), data: utils.bytes.bs58.encode(send), stackHeight: 2 },
      { programIdIndex: index(pid), accounts: [index(keys.eventAuthority)], data: utils.bytes.bs58.encode(event), stackHeight: 2 },
    ];
    const signature = utils.bytes.bs58.encode(transaction.signature);
    return { signature, sourceMessage, amount: String(amount), maxFee: String(fee), recipient: `0x${hook.subarray(32).toString("hex")}`,
      eventAccount: ix.keys[11].pubkey.toBase58(), raw: {
        slot: occurrenceSlot, version: "legacy", blockTime: 1_790_000_000,
        transaction: { signatures: transaction.signatures.map(row => utils.bytes.bs58.encode(row.signature)),
          message: { accountKeys, recentBlockhash: compiled.recentBlockhash, header: compiled.header, instructions: compiled.instructions } },
        meta: { err: null, fee: 10_000, preBalances: accountKeys.map(() => 10_000_000), postBalances: accountKeys.map(() => 10_000_000),
          innerInstructions: [{ index: 0, instructions: inner }], logMessages: [], preTokenBalances: [], postTokenBalances: [], rewards: [] },
      } };
  }
  async function solana(method, params) {
    switch (method) {
      case "getGenesisHash": return deployment.source.genesisHash;
      case "getAccountInfo": return context(await sourceAccount(params[0]));
      case "getMultipleAccounts": return context(await Promise.all(params[0].map(sourceAccount)));
      case "getBalance": return context(10_000_000_000);
      case "getLatestBlockhash": return context({ blockhash: zero.toBase58(), lastValidBlockHeight: 200 });
      case "getSlot":
        if (scenario.finalized) finalizedSlot = latestSlot;
        return finalizedSlot;
      case "getBlockHeight": return scenario.expired ? 300 : latestSlot;
      case "getMinimumBalanceForRentExemption": assert.equal(params[0], 492); return 4_315_200;
      case "getFeeForMessage": return context(10_000);
      case "simulateTransaction": {
        const tx = Transaction.from(Buffer.from(params[0], "base64"));
        assert.equal(tx.instructions[0].data.subarray(0, 8).toString("hex"), "6ff53e83cc6cdf9b");
        simulations.push({ bytes: params[0], config: params[1] });
        return context({ err: scenario.sourceSimulationFails ? { InstructionError: [0, "InvalidArgument"] } : null, logs: [], accounts: null, unitsConsumed: 100_000, returnData: null });
      }
      case "sendTransaction": {
        // A new burn occurs after the previously observed finalized bank.
        // Re-sending the same signature retains its original occurrence.
        const candidate = sourceFixture(Transaction.from(Buffer.from(params[0], "base64")), latestSlot + 1);
        const record = transactions.get(candidate.signature) ?? candidate;
        latestSlot = Math.max(latestSlot, record.raw.slot);
        sends.push({ signature: record.signature, bytes: params[0] }); transactions.set(record.signature, record);
        if (scenario.lostSend && sends.length === 1) throw Object.assign(new Error("Lost send response"), { disconnect: true });
        return record.signature;
      }
      case "getSignatureStatuses": return context(params[0].map(signature => transactions.has(signature) && scenario.finalized
        ? { slot: transactions.get(signature).raw.slot, confirmations: null, err: scenario.sourceFailed ? { InstructionError: [0, "InvalidArgument"] } : null, confirmationStatus: "finalized" } : null));
      case "getTransaction": {
        assert.equal(params[1].maxSupportedTransactionVersion, 1);
        assert.equal(params[1].commitment, "finalized");
        const found = transactions.get(params[0]);
        if (!found || !scenario.finalized) return null;
        const raw = structuredClone(found.raw);
        if (scenario.sourceFailed) raw.meta.err = { InstructionError: [0, "InvalidArgument"] };
        if (scenario.mutation === "source-signature") raw.transaction.signatures[0] = utils.bytes.bs58.encode(new Uint8Array(64).fill(9));
        if (scenario.mutation === "source-ambiguous") raw.meta.innerInstructions[0].instructions.push(raw.meta.innerInstructions[0].instructions[2]);
        if (scenario.mutation === "source-hook") raw.meta.innerInstructions[0].instructions[2].data = utils.bytes.bs58.encode(Buffer.concat([Buffer.from(utils.bytes.bs58.decode(raw.meta.innerInstructions[0].instructions[2].data)).subarray(0, -1), Buffer.from([1])]));
        return raw;
      }
      case "getSignaturesForAddress": return (scenario.finalized ? [...transactions.values()] : []).filter(row => row.eventAccount === params[0]).map(row => ({ signature: row.signature, slot: row.raw.slot, err: null, memo: null, blockTime: 1_790_000_000, confirmationStatus: "finalized" }));
      default: throw new Error(`Unimplemented fixture Solana method ${method}`);
    }
  }
  async function attested(record) {
    const message = Buffer.from(record.sourceMessage);
    uint(1234, 32).copy(message, 12); uint(2000, 4).copy(message, 144);
    uint(scenario.executedFee, 32).copy(message, 312);
    if (scenario.mutation === "finality") uint(500, 4).copy(message, 144);
    if (scenario.mutation === "expiry") uint(9999, 32).copy(message, 344);
    if (scenario.mutation === "amount") uint(BigInt(record.amount) + 1n, 32).copy(message, 216);
    if (scenario.mutation === "helper") bytes32(`0x${"99".repeat(20)}`).copy(message, 184);
    if (scenario.mutation === "hook") message[439] ^= 1;
    if (scenario.mutation === "source-account") owner.publicKey.toBuffer().reverse().copy(message, 248);
    const hex = `0x${message.toString("hex")}`;
    const signature = await attester.sign({ hash: keccak256(hex) });
    return { message: hex, attestation: scenario.mutation === "attestation" ? `0x${"01".repeat(65)}` : signature,
      status: "complete", eventNonce: `0x${uint(1234, 32).toString("hex")}`, cctpVersion: 2,
      sourceTxHash: scenario.mutation === "envelope" ? utils.bytes.bs58.encode(new Uint8Array(64).fill(9)) : record.signature };
  }
  async function arc(method, params) {
    if (method === "eth_chainId") return `0x${deployment.arc.chainId.toString(16)}`;
    if (method === "eth_blockNumber") return "0x69";
    if (method === "eth_getCode") {
      assert([deployment.helper, ...Object.values(deployment.arc).filter(value => typeof value === "object")].some(value => value.address === params[0].toLowerCase()));
      return scenario.codeMismatch === params[0].toLowerCase() ? "0x60016000" : "0x60006000";
    }
    assert.equal(method, "eth_call", "Fixture refuses all Arc writes.");
    const call = params[0], { functionName, args = [] } = decodeFunctionData({ abi, data: call.data });
    if (["receiveMessage", "receiveAndDeposit"].includes(functionName)) {
      assert.equal(call.to.toLowerCase(), functionName === "receiveMessage" ? deployment.arc.messageTransmitter.address : deployment.helper.address);
      assert.equal(call.from?.toLowerCase(), functionName === "receiveMessage" ? deployment.helper.address : `0x${"77".repeat(20)}`);
      assert.equal((await recoverAddress({ hash: keccak256(args[0]), signature: args[1] })).toLowerCase(), attester.address.toLowerCase(), "Invalid fixture attestation signature");
      if (functionName === "receiveAndDeposit" && scenario.helperSimulationFails) throw new Error("Synthetic helper simulation reverted");
      // Circle's positive-fee path mints principal and fee separately. If both
      // recipients are the helper its delta is gross, violating the helper's net check.
      if (functionName === "receiveAndDeposit" && scenario.feeRecipient.toLowerCase() === deployment.helper.address &&
          BigInt(`0x${args[0].slice(2 + 312 * 2, 2 + 344 * 2)}`) > 0n) throw new Error("Helper received gross instead of net");
      return functionName === "receiveMessage" ? encodeFunctionResult({ abi, functionName, result: true }) : "0x";
    }
    const target = call.to.toLowerCase();
    const helperReads = ["messageTransmitter", "tokenMessenger", "usdc", "xReserve", "midenDomain", "expectedMidenFaucet"];
    const reserveReads = ["domainDepositsPaused", "isRemoteDomainRegistered", "getRemoteToken", "isBlocklisted", "domainWithdrawalsPaused", "getRemoteDomainDepositor", "getRemoteDomainHookExecutor", "gatewayWallet", "gatewayMinter", "domain"];
    const transmitterReads = ["localDomain", "version", "signatureThreshold", "maxMessageBodySize"];
    const messengerReads = ["messageBodyVersion", "localMessageTransmitter", "localMinter", "remoteTokenMessengers", "feeRecipient"];
    if (helperReads.includes(functionName)) assert.equal(target, deployment.helper.address);
    if (reserveReads.includes(functionName)) assert.equal(target, deployment.arc.xReserve.address);
    if (transmitterReads.includes(functionName)) assert.equal(target, deployment.arc.messageTransmitter.address);
    if (messengerReads.includes(functionName)) assert.equal(target, deployment.arc.tokenMessenger.address);
    if (functionName === "feeRecipient") {
      if (scenario.feeRecipientResult === "error") throw new Error("Fee recipient getter unavailable");
      if (scenario.feeRecipientResult === "malformed") return "0x01";
    }
    if (functionName === "isBlacklisted") {
      assert.equal(target, deployment.arc.usdc.address);
      assert([deployment.helper.address, deployment.arc.xReserve.address, deployment.arc.tokenMinter.address, deployment.arc.gatewayWallet.address, deployment.miden.remoteDomainDepositor, scenario.feeRecipient].includes(args[0].toLowerCase()));
    }
    if (["domainDepositsPaused", "isRemoteDomainRegistered", "getRemoteToken", "isBlocklisted"].includes(functionName)) assert.equal(args[0], 10007);
    if (functionName === "getRemoteToken") assert.equal(args[1].toLowerCase(), deployment.arc.usdc.address);
    if (functionName === "isTokenSupported") {
      assert([deployment.arc.xReserve.address, deployment.arc.gatewayWallet.address].includes(target));
      assert.equal(args[0].toLowerCase(), deployment.arc.usdc.address);
    }
    if (functionName === "isDenylisted") {
      assert.equal(target, deployment.arc.gatewayWallet.address);
      assert([deployment.arc.xReserve.address, deployment.miden.remoteDomainDepositor].includes(args[0].toLowerCase()));
    }
    if (functionName === "allowance") {
      assert.equal(target, deployment.arc.usdc.address);
      assert.deepEqual(args.map(value => value.toLowerCase()), [deployment.arc.xReserve.address, deployment.arc.gatewayWallet.address]);
    }
    if (["isMinter", "minterAllowance"].includes(functionName)) {
      assert.equal(target, deployment.arc.usdc.address); assert.equal(args[0].toLowerCase(), deployment.arc.tokenMinter.address);
    }
    if (functionName === "localTokenMessenger") assert.equal(target, deployment.arc.tokenMinter.address);
    if (functionName === "remoteTokenMessengers") assert.equal(args[0], 5);
    if (functionName === "getLocalToken") {
      assert.equal(target, deployment.arc.tokenMinter.address); assert.equal(args[0], 5);
      assert.equal(args[1], `0x${mint.toBuffer().toString("hex")}`);
    }
    const values = {
      messageTransmitter: deployment.arc.messageTransmitter.address, tokenMessenger: deployment.arc.tokenMessenger.address,
      usdc: deployment.arc.usdc.address, xReserve: deployment.arc.xReserve.address, midenDomain: 10007,
      expectedMidenFaucet: `0x${deployment.miden.faucetId.slice(2).padStart(62, "0")}00`,
      getRemoteToken: `0x${deployment.miden.faucetId.slice(2).padStart(62, "0")}00`,
      paused: false, domainDepositsPaused: false, isRemoteDomainRegistered: true, isTokenSupported: true,
      isBlocklisted: false, isBlacklisted: false, localDomain: 26, version: 1, messageBodyVersion: 1,
      localMessageTransmitter: deployment.arc.messageTransmitter.address, localMinter: deployment.arc.tokenMinter.address,
      remoteTokenMessengers: `0x${pid.toBuffer().toString("hex")}`, getLocalToken: deployment.arc.usdc.address,
      feeRecipient: scenario.feeRecipient, domain: 26, decimals: 6, domainWithdrawalsPaused: false,
      getRemoteDomainDepositor: deployment.miden.remoteDomainDepositor, getRemoteDomainHookExecutor: `0x${"00".repeat(20)}`,
      gatewayWallet: deployment.arc.gatewayWallet.address, gatewayMinter: deployment.arc.gatewayMinter.address,
      isDenylisted: false, allowance: 1_000_000_000n, isMinter: true, minterAllowance: 1_000_000_000n,
      localTokenMessenger: deployment.arc.tokenMessenger.address, signatureThreshold: 1n, maxMessageBodySize: 8192n,
    };
    assert(Object.hasOwn(values, functionName), `Unimplemented Arc read ${functionName}`);
    const policy = scenario.policy;
    const matches = policy?.functionName === functionName && (!policy.target || policy.target === target) &&
      (!policy.principal || policy.principal === args[0]?.toLowerCase());
    const result = matches ? (typeof values[functionName] === "bigint" ? BigInt(policy.value) : policy.value) : values[functionName];
    return encodeFunctionResult({ abi, functionName, result });
  }
  async function body(request) { let text = ""; for await (const chunk of request) { text += chunk; assert(text.length < 100_000); } return text ? JSON.parse(text) : {}; }
  const servers = [];
  async function listen(handler) {
    const server = http.createServer(async (request, response) => {
      try { await handler(request, response); } catch (error) { response.writeHead(500, { "content-type": "application/json" }); response.end(JSON.stringify({ error: String(error) })); }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    servers.push(server); return `http://127.0.0.1:${server.address().port}`;
  }
  const reply = (response, value) => { response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value)); };
  const rpc = kind => async (request, response) => {
    assert.equal(request.method, "POST");
    const value = await body(request); assert(!Array.isArray(value), "No unbounded fixture batch");
    calls.push({ kind, method: value.method, params: value.params });
    try { reply(response, { jsonrpc: "2.0", id: value.id, result: await (kind === "solana" ? solana : arc)(value.method, value.params ?? []) }); }
    catch (error) { if (error.disconnect) request.socket.destroy(); else reply(response, { jsonrpc: "2.0", id: value.id, error: { code: -32000, message: String(error) } }); }
  };
  const solanaRpc = await listen(rpc("solana")), arcRpc = await listen(rpc("arc"));
  const irisApi = await listen(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    assert.equal(request.method, "GET"); calls.push({ kind: "iris", method: url.pathname });
    if (url.pathname === "/v2/burn/USDC/fees/5/26") return reply(response, [{ finalityThreshold: 2000, minimumFee: scenario.feeBps }]);
    assert.equal(url.pathname, "/v2/messages/5");
    const record = transactions.get(url.searchParams.get("transactionHash"));
    const row = record && !scenario.attestationPending ? await attested(record) : null;
    reply(response, { sourceTxHash: row?.sourceTxHash ?? url.searchParams.get("transactionHash"),
      messages: row ? (scenario.mutation === "ambiguous" ? [row, { ...row }] : [row]) : [] });
  });
  const state = () => ({ scenario, calls, sends, simulations, transactions: [...transactions.values()].map(({ sourceMessage, raw, ...value }) => ({ ...value, sourceMessage: `0x${sourceMessage.toString("hex")}`, raw })) });
  const controlUrl = await listen(async (request, response) => {
    assert(!request.headers.origin, "Fixture controls are test-process only.");
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/reset") {
      scenario = { ...scenarioDefaults, ...await body(request) }; latestSlot = initialFinalizedSlot; finalizedSlot = initialFinalizedSlot;
      transactions = new Map(); calls = []; sends = []; simulations = [];
    } else if (request.method === "POST" && url.pathname === "/scenario") Object.assign(scenario, await body(request));
    else assert(request.method === "GET" && url.pathname === "/state");
    reply(response, state());
  });
  return { endpoints: { solanaRpc, arcRpc, irisApi }, controlUrl,
    close: async () => {
      await fs.writeFile(path.join(runRoot, "fixture-final-state.json"), JSON.stringify(state(), null, 2));
      await Promise.all(servers.map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
    } };
}
