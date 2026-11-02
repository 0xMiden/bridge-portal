#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, constants } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Builds synthetic, local-only configuration in an owned copy. Never deploy it.
const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  assert(["--source", "--evidence", "--grep", "--http-only"].includes(key) && value, `Unknown or incomplete option: ${key}`);
  options.set(key, value);
}
assert(process.versions.node === "22.18.0", "Use Node 22.18.0 for the fixture build and browser suite.");
const sourceRoot = await fs.realpath(path.resolve(options.get("--source") ?? testRoot));
assert(!options.has("--http-only") || options.get("--http-only") === "true", "--http-only accepts only true and does not prove browser acceptance.");
const evidenceRoot = path.resolve(options.get("--evidence") ?? path.join(testRoot, "test-results/helper-runs"));
await fs.mkdir(evidenceRoot, { recursive: true });
const runRoot = await fs.mkdtemp(path.join(evidenceRoot, "run-"));
const fixtureRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "miden-helper-browser-")));
const logPath = path.join(runRoot, "commands.jsonl");
const owned = ["e2e/fixtures/cctp-helper-public.json", "e2e/fixtures/cctp-helper-server.json",
  "e2e/helper", "e2e/tests/helper/cctp-helper.spec.ts", "playwright.helper.config.ts", "scripts/test-helper-browser.mjs"];
const excluded = new Set(["node_modules", ".git", ".next", ".open-next", ".wrangler", ".vercel", "coverage", "test-results", "playwright-report", ".cache", ".npmrc", ".yarnrc.yml", ".aws", ".ssh", ".config"]);
const children = new Set();
let services;
const sha = value => createHash("sha256").update(value).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const isSource = name => !name.split("/").some(part => excluded.has(part) || part.startsWith(".env") || /(?:\.pem|\.key|\.p12|\.pfx|tsbuildinfo)$/.test(part));
const environment = {
  PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
  HOME: os.homedir(), TMPDIR: os.tmpdir(), CI: "1", NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "00000000000000000000000000000000",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1",
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(evidenceRoot, "browsers"),
};
function git(args, cwd = sourceRoot) { return execFileSync("git", args, { cwd, encoding: "utf8" }).trim(); }
async function command(label, args, cwd, extraEnv = {}, executable = process.execPath) {
  const output = createWriteStream(path.join(runRoot, `${label}.log`));
  const start = new Date().toISOString();
  const child = spawn(executable, args, { cwd, env: { ...environment, ...extraEnv }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  let captured = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {
    output.write(chunk);
    captured += chunk.toString();
  });
  const exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  children.delete(child);
  await new Promise(resolve => output.end(resolve));
  await fs.appendFile(logPath, json({ label, command: [executable, ...args], cwd, start, end: new Date().toISOString(), exitCode }));
  console.log(`${label}: exit ${exitCode}; ${path.join(runRoot, `${label}.log`)}`);
  assert.equal(exitCode, 0, `${label} failed; see its complete log.`);
  return captured;
}
async function hashes(root, files) {
  return Promise.all(files.sort().map(async name => ({ path: name, sha256: sha(await fs.readFile(path.join(root, name))) })));
}
async function enumerate(root, relative = "") {
  const stat = await fs.lstat(path.join(root, relative));
  assert(!stat.isSymbolicLink(), `Refusing source symlink: ${relative}`);
  if (stat.isFile()) return [relative];
  const rows = [];
  for (const entry of await fs.readdir(path.join(root, relative))) rows.push(...await enumerate(root, path.join(relative, entry)));
  return rows;
}
async function loopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function stopOwned() {
  for (const child of children) {
    try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  if (services) await services.close();
}
const interrupt = () => { process.exitCode = 130; void stopOwned(); };
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

try {
  const files = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean).filter(isSource);
  const manifest = { testOnly: true, sourceRoot, sourceHead: git(["rev-parse", "HEAD"]),
    sourceBranch: git(["branch", "--show-current"]), sourceStatus: git(["status", "--short"]),
    node: process.version, runRoot, fixtureRoot, files: await hashes(sourceRoot, [...new Set(files)]) };
  const initialLock = await fs.readFile(path.join(sourceRoot, "package-lock.json"));
  manifest.sourceHash = sha(json(manifest.files));
  manifest.lockHash = sha(initialLock);
  for (const entry of manifest.files) {
    const from = path.join(sourceRoot, entry.path), to = path.join(fixtureRoot, entry.path);
    assert((await fs.lstat(from)).isFile(), `Refusing non-file source: ${entry.path}`);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    assert.equal(sha(await fs.readFile(to)), entry.sha256, `Source changed during snapshot: ${entry.path}`);
  }
  const testFiles = [];
  for (const item of owned) testFiles.push(...await enumerate(testRoot, item));
  manifest.testFiles = await hashes(testRoot, testFiles);
  for (const item of testFiles) {
    const target = path.join(fixtureRoot, item);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(testRoot, item), target);
  }
  for (const name of ["public", "server"]) {
    const release = JSON.parse(await fs.readFile(path.join(sourceRoot, `src/config/cctp-helper-${name}.json`), "utf8"));
    assert(Array.isArray(release) && release.every(entry => name === "public" && entry.enabled === false), "Release helper entries must be absent/disabled.");
  }
  // Clone only an exact installed dependency graph. A symlink outside the build
  // root breaks Next standalone tracing. CoW copies keep writes owned and fall
  // back to ordinary copies where the filesystem does not support cloning.
  const wanted = JSON.parse(initialLock).packages;
  const installed = JSON.parse(await fs.readFile(path.join(sourceRoot, "node_modules/.package-lock.json"), "utf8")).packages;
  for (const [name, pkg] of Object.entries(wanted)) if (name && !pkg.optional) {
    assert(installed[name], `Missing dependency ${name}; install the candidate lock before this runner.`);
    for (const key of ["version", "resolved", "integrity"]) assert.equal(installed[name][key], pkg[key], `Dependency drift: ${name}:${key}`);
  }
  if (process.platform === "darwin") {
    await command("clone-dependencies", ["-cR", path.join(sourceRoot, "node_modules"), path.join(fixtureRoot, "node_modules")], fixtureRoot, {}, "/bin/cp");
  } else {
    await fs.cp(path.join(sourceRoot, "node_modules"), path.join(fixtureRoot, "node_modules"), {
      recursive: true, dereference: false, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
    });
  }
  assert.equal(sha(await fs.readFile(path.join(sourceRoot, "package-lock.json"))), manifest.lockHash, "Dependency lock changed while copying.");
  const playwright = path.join(fixtureRoot, "node_modules/@playwright/test/cli.js");
  const ordinary = await command("ordinary-collection", [path.join(sourceRoot, "node_modules/@playwright/test/cli.js"), "test", "--config", "playwright.config.ts", "--list", "--reporter=list"], sourceRoot);
  assert(/Total: [1-9]\d* tests?/.test(ordinary) && !ordinary.includes("cctp-helper.spec") && !ordinary.includes("Solana manual"), "Ordinary collection must be nonempty and exclude helper tests.");
  const fixtureModule = await import(pathToFileURL(path.join(fixtureRoot, "e2e/helper/services.mjs")).href);
  services = await fixtureModule.startFixtureServices({ fixtureRoot, runRoot });
  const publicFixture = JSON.parse(await fs.readFile(path.join(fixtureRoot, "e2e/fixtures/cctp-helper-public.json"), "utf8"));
  const privateFixture = JSON.parse(await fs.readFile(path.join(fixtureRoot, "e2e/fixtures/cctp-helper-server.json"), "utf8"));
  for (const row of privateFixture) Object.assign(row, services.endpoints);
  await fs.writeFile(path.join(fixtureRoot, "src/config/cctp-helper-public.json"), json(publicFixture));
  await fs.writeFile(path.join(fixtureRoot, "src/config/cctp-helper-server.json"), json(privateFixture));
  await fs.writeFile(path.join(fixtureRoot, ".helper-fixture.json"), json({ testOnly: true, runRoot, sourceRoot: fixtureRoot, sourceHash: manifest.sourceHash }));
  const port = await loopbackPort();
  Object.assign(environment, { HELPER_BROWSER_RUN_ROOT: runRoot, HELPER_BROWSER_PORT: String(port), HELPER_FIXTURE_CONTROL_URL: services.controlUrl });
  manifest.fixtureFiles = await hashes(fixtureRoot, ["src/config/cctp-helper-public.json", "src/config/cctp-helper-server.json", "playwright.helper.config.ts"]);
  await fs.writeFile(path.join(runRoot, "manifest.json"), json(manifest));
  const dedicated = await command("helper-collection", [playwright, "test", "--config", "playwright.helper.config.ts", "--list", "--reporter=list"], fixtureRoot);
  assert(/Total: [1-9]\d* tests?/.test(dedicated) && dedicated.includes("Solana manual"), "Dedicated collection must include nonzero manual Solana tests.");
  await command("fixture-config", ["--experimental-strip-types", "scripts/check-wallet-config.mjs"], fixtureRoot);
  await command("fixture-build", ["node_modules/next/dist/bin/next", "build", "--webpack"], fixtureRoot);
  manifest.buildId = (await fs.readFile(path.join(fixtureRoot, ".next/BUILD_ID"), "utf8")).trim();
  manifest.buildManifestHash = sha(await fs.readFile(path.join(fixtureRoot, ".next/build-manifest.json")));
  await fs.writeFile(path.join(runRoot, "manifest.json"), json(manifest));
  if (options.has("--http-only")) {
    await command("helper-http", ["e2e/helper/http-smoke.mjs"], fixtureRoot);
    await fs.writeFile(path.join(runRoot, "result.json"), json({ state: "http-passed-browser-not-run", sourceHash: manifest.sourceHash, fixtureRoot, testOnly: true }));
    console.log(`HTTP checks passed; browser acceptance NOT RUN. Evidence: ${runRoot}`);
  } else {
  process.env.PLAYWRIGHT_BROWSERS_PATH = environment.PLAYWRIGHT_BROWSERS_PATH;
  const { chromium } = await import(pathToFileURL(path.join(fixtureRoot, "node_modules/playwright/index.mjs")).href);
  try { await fs.access(chromium.executablePath()); } catch { await command("browser-install", [playwright, "install", "chromium"], fixtureRoot); }
  const args = [playwright, "test", "--config", "playwright.helper.config.ts"];
  if (options.has("--grep")) args.push("--grep", options.get("--grep"));
  await command("helper-execution", args, fixtureRoot);
  const report = JSON.parse(await fs.readFile(path.join(runRoot, "playwright-results.json"), "utf8"));
  assert(report.stats.expected > 0 && report.stats.unexpected === 0 && report.stats.skipped === 0, "Zero/skipped/failed tests are not a pass.");
  assert.equal(sha(await fs.readFile(path.join(sourceRoot, "package-lock.json"))), manifest.lockHash, "Writer lock changed during test run; repeat against the new candidate.");
  await fs.writeFile(path.join(runRoot, "result.json"), json({ state: "passed", sourceHash: manifest.sourceHash, stats: report.stats, fixtureRoot, testOnly: true }));
  console.log(`Helper browser proof passed against ${manifest.sourceHash}. Evidence: ${runRoot}`);
  }
} catch (error) {
  process.exitCode = 1;
  await fs.writeFile(path.join(runRoot, "result.json"), json({ state: "failed", error: String(error), fixtureRoot, testOnly: true }));
  console.error(error);
  console.error(`Evidence: ${runRoot}; isolated copy retained at ${fixtureRoot}`);
} finally {
  await stopOwned();
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
