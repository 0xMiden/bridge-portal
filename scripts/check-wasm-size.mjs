#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

// Cloudflare Workers per-asset limit is 25 MiB. Stay 1 MiB under.
const MAX_BYTES = 24 * 1024 * 1024;
const ROOT = "node_modules/@miden-sdk/miden-sdk/dist/st";

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.name.endsWith(".wasm")) files.push(path);
  }
  return files;
}

const files = await walk(ROOT);
if (files.length === 0) {
  console.error(`no .wasm files under ${ROOT}`);
  process.exit(1);
}

let failed = false;
for (const file of files) {
  const { size } = await stat(file);
  const mb = (size / (1024 * 1024)).toFixed(1);
  const ok = size <= MAX_BYTES;
  console.log(`${ok ? "ok" : "TOO BIG"} ${mb} MiB  ${file}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
