import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// E218 injects a hard process termination at three real filesystem boundaries.
// No production code is patched, and every test uses a disposable HOME.
const moduleUrl = new URL("../../src/state-store.mjs", import.meta.url).href;
const childScript = [
  'import fs from "node:fs/promises";',
  'const phase = process.env.CRASH_PHASE;',
  'const crash = () => process.kill(process.pid, "SIGKILL");',
  'if (phase === "lock") {',
  '  const mkdir = fs.mkdir;',
  '  fs.mkdir = async (...args) => {',
  '    const result = await mkdir(...args);',
  '    if (String(args[0]).endsWith("state.json.lock")) crash();',
  '    return result;',
  '  };',
  '}',
  'if (phase === "temp") {',
  '  const writeFile = fs.writeFile;',
  '  fs.writeFile = async (...args) => {',
  '    const result = await writeFile(...args);',
  '    if (/state\\.json\\.[0-9]+\\.tmp$/.test(String(args[0]))) crash();',
  '    return result;',
  '  };',
  '}',
  'if (phase === "rename") {',
  '  const rename = fs.rename;',
  '  fs.rename = async (...args) => {',
  '    const result = await rename(...args);',
  '    if (String(args[1]).endsWith("state.json")) crash();',
  '    return result;',
  '  };',
  '}',
  'const { createBridgeStore, readPersistedState } = await import(' + JSON.stringify(moduleUrl) + ');',
  'const initialState = await readPersistedState();',
  'const store = createBridgeStore({ token: "isolated-e218", initialState, now: () => Number(process.env.SYNC_TIME) });',
  'await store.updateSnapshot({ preferences: { [process.env.WRITER_ID]: { verdict: "essential" } } });'
].join("\n");

function run(home, id, time, phase = "") {
  return spawnSync(process.execPath, ["--input-type=module", "-e", childScript], {
    env: { ...process.env, HOME: home, WRITER_ID: id, SYNC_TIME: String(time), CRASH_PHASE: phase },
    encoding: "utf8",
    timeout: 15_000
  });
}

async function readCanonical(home) {
  return JSON.parse(await fs.readFile(path.join(home, ".xtension", "state.json"), "utf8"));
}

for (const phase of ["lock", "temp", "rename"]) {
  test("E218 SIGKILL after " + phase + " preserves canonical state and fails closed until verified recovery", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "xtension-e218-"));
    const dir = path.join(home, ".xtension");
    const lock = path.join(dir, "state.json.lock");
    try {
      const baseline = run(home, "baseline", 1000);
      assert.equal(baseline.status, 0, baseline.stderr);

      const crashed = run(home, "interrupted", 2000, phase);
      assert.equal(crashed.signal, "SIGKILL", "expected hard termination at " + phase + ": " + crashed.stderr);
      await fs.access(lock); // A hard crash leaves a lock, never silently reclaims it.

      const canonical = await readCanonical(home);
      assert.equal(canonical.lastSyncAt, phase === "rename" ? 2000 : 1000);
      assert.deepEqual(Object.keys(canonical.snapshot.preferences), [
        phase === "rename" ? "interrupted" : "baseline"
      ]);

      const leftovers = (await fs.readdir(dir)).filter((name) => /^state\.json\.[0-9]+\.tmp$/.test(name));
      assert.equal(leftovers.length, phase === "temp" ? 1 : 0);

      // Even if the canonical rename completed, another writer must not bypass
      // the abandoned lock. No attempt at automatic lock stealing is allowed.
      const blocked = run(home, "blocked", 3000);
      assert.notEqual(blocked.status, 0, "abandoned lock must block subsequent writers");
      assert.match(blocked.stderr, /holds the state write lock/i);
      assert.deepEqual(await readCanonical(home), canonical);

      // Recovery is simulated only AFTER spawnSync confirms the child exited,
      // and after inspecting canonical JSON and the precise temp artifacts.
      for (const name of leftovers) await fs.rm(path.join(dir, name));
      await fs.rmdir(lock);
      const recovered = run(home, "recovered", 4000);
      assert.equal(recovered.status, 0, recovered.stderr);
      const final = await readCanonical(home);
      assert.equal(final.lastSyncAt, 4000);
      assert.deepEqual(Object.keys(final.snapshot.preferences), ["recovered"]);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });
}
