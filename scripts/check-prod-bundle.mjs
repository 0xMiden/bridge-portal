#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const ROOTS = [".next", ".open-next"];
const SKIP_DIR = new Set(["cache", "trace"]);
// Match assignments/properties, not runtime comparisons preserved by OpenNext.
const KEY_VALUE = /\bNEXT_PUBLIC_E2E_TEST["'`]?\s*(?::|=(?!=))\s*["'`]?true\b/;
const PRIVKEY = /NEXT_PUBLIC_E2E_EVM_PRIVATE_KEY["'`\s:=]+0x[0-9a-fA-F]{64}/;
const SEED = /(?:NEXT_PUBLIC_)?E2E_MIDEN_SEED["'`\s:=]+0x[0-9a-fA-F]{16,}/;

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue;
      files.push(...(await walk(path)));
    } else if (/\.(js|mjs|cjs|json|html)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const files = (await Promise.all(ROOTS.map(walk))).flat();
if (files.length === 0) {
  console.error("check-prod-bundle: no .next or .open-next output. Run a production build first.");
  process.exit(1);
}

const hits = [];
for (const file of files) {
  const { size } = await stat(file);
  if (size > 20 * 1024 * 1024) continue;
  const text = await readFile(file, "utf8");
  if (KEY_VALUE.test(text)) hits.push(`${file}: NEXT_PUBLIC_E2E_TEST inlined true`);
  if (PRIVKEY.test(text)) hits.push(`${file}: E2E EVM private key inlined`);
  if (SEED.test(text)) hits.push(`${file}: E2E Miden seed inlined`);
}

if (hits.length > 0) {
  console.error("check-prod-bundle: E2E secrets or test flag found in production output:");
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
console.log(`check-prod-bundle: ok (${files.length} files)`);
