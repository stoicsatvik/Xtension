import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const moduleUrl = new URL("../src/state-store.mjs", import.meta.url).href;
const childScript = `
  import { readPersistedState } from ${JSON.stringify(moduleUrl)};
  try {
    const state = await readPersistedState();
    process.stdout.write(JSON.stringify(state));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
`;

async function withIsolatedHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "xtension-e215-"));
  const dir = path.join(home, ".xtension");
  await fs.mkdir(dir, { recursive: true });
  try {
    const run = () => spawnSync(process.execPath, ["--input-type=module", "-e", childScript], {
      env: { ...process.env, HOME: home },
      encoding: "utf8",
      timeout: 10000
    });
    await fn({ dir, run });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

test("corrupted canonical state fails closed rather than resetting to empty", async () => {
  await withIsolatedHome(async ({ dir, run }) => {
    const stateFile = path.join(dir, "state.json");
    const damaged = '{"lastSyncAt":101,"snapshot":{"preferences":';
    await fs.writeFile(stateFile, damaged);
    const result = run();
    assert.equal(result.status, 1, `must refuse corrupt state: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /invalid.*persisted state|corrupt.*state/i);
    assert.equal(await fs.readFile(stateFile, "utf8"), damaged, "must preserve evidence");
  });
});

test("well-formed but invalid canonical state fails closed", async () => {
  await withIsolatedHome(async ({ dir, run }) => {
    await fs.writeFile(path.join(dir, "state.json"), "null");
    const result = run();
    assert.equal(result.status, 1, `must reject invalid root: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /invalid.*persisted state|corrupt.*state/i);
  });
});

test("genuinely missing canonical state permits first-time initialization", async () => {
  await withIsolatedHome(async ({ run }) => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { lastSyncAt: 0, snapshot: {} });
  });
});

test("orphaned crash temp does not override a valid canonical state", async () => {
  await withIsolatedHome(async ({ dir, run }) => {
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify({
      lastSyncAt: 101, snapshot: { preferences: { abc: { verdict: "essential" } }, rawHistory: ["private"] }
    }));
    await fs.writeFile(path.join(dir, "state.json.999999.tmp"), '{"lastSyncAt":999,');
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      lastSyncAt: 101, snapshot: { preferences: { abc: { verdict: "essential" } } }
    });
  });
});
