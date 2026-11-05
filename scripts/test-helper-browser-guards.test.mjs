import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const runner = fileURLToPath(new URL("./test-helper-browser.mjs", import.meta.url));
for (const relation of ["same", "child", "parent"]) {
  test(`rejects a ${relation} source/fixture alias before copying source`, async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "helper-guard-")));
    try {
      const child = path.join(root, "nested");
      await mkdir(child);
      const source = relation === "parent" ? child : root;
      const fixture = relation === "child" ? child : root;
      const sentinel = path.join(source, "source-sentinel");
      await writeFile(sentinel, "preserve source");
      const result = spawnSync(process.execPath, [runner, "--source", source, "--reuse-fixture", fixture,
        "--evidence", path.join(root, "evidence")], { encoding: "utf8" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Source and fixture directories must be disjoint/);
      assert.equal(await readFile(sentinel, "utf8"), "preserve source");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
test("records unchanged source registries and lock even when fixture setup fails", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "helper-failure-guard-")));
  try {
    const fixture = path.join(root, "fixture"), evidence = path.join(root, "evidence");
    await mkdir(fixture);
    const result = spawnSync(process.execPath, [runner, "--reuse-fixture", fixture, "--evidence", evidence], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\.helper-fixture\.json/);
    const [run] = await readdir(evidence);
    const integrity = JSON.parse(await readFile(path.join(evidence, run, "source-integrity.json"), "utf8"));
    assert.equal(integrity.state, "unchanged");
    assert.equal(integrity.releaseRegistries.length, 4);
    assert.match(integrity.lockHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(await readdir(fixture), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
