import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// E216's original expected-red falsification is preserved in research docs.
// E217 promotes its cross-process invariant to a passing regression test.
const moduleUrl = new URL("../../src/state-store.mjs", import.meta.url).href;
const childScript = `
  import fs from "node:fs/promises";
  import { createBridgeStore, readPersistedState } from ${JSON.stringify(moduleUrl)};
  const initialState = await readPersistedState();
  if (process.env.WAIT_FILE) {
    await fs.writeFile(process.env.READY_FILE, "ready");
    let released = false;
    for (let i = 0; i < 500; i++) {
      try { await fs.access(process.env.WAIT_FILE); released = true; break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    if (!released) throw new Error("test barrier timed out");
  }
  const store = createBridgeStore({
    token: "isolated-e216",
    initialState,
    now: () => Number(process.env.SYNC_TIME)
  });
  await store.updateSnapshot({
    preferences: { [process.env.WRITER_ID]: { verdict: "essential" } }
  });
`;

async function isolatedHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "xtension-e216-"));
  await fs.mkdir(path.join(home, ".xtension"), { recursive: true });
  try { await fn(home); }
  finally { await fs.rm(home, { recursive: true, force: true }); }
}

function writerEnv(home, id, time, extra = {}) {
  return {
    ...process.env, HOME: home, WRITER_ID: id,
    SYNC_TIME: String(time), ...extra
  };
}

async function waitForFile(file) {
  for (let i = 0; i < 500; i++) {
    try { await fs.access(file); return; }
    catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
  }
  throw new Error("writer readiness timed out");
}

test("control: one isolated process can write and reload a canonical state", async () => {
  await isolatedHome(async (home) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", childScript], {
      env: writerEnv(home, "newer", 2000), encoding: "utf8", timeout: 15000
    });
    assert.equal(result.status, 0, result.stderr);
    const persisted = JSON.parse(await fs.readFile(path.join(home, ".xtension", "state.json"), "utf8"));
    assert.equal(persisted.lastSyncAt, 2000);
    assert.equal(persisted.snapshot.preferences.newer.verdict, "essential");
  });
});

test("stale writer must not regress canonical timestamp or discard newer state", async () => {
  await isolatedHome(async (home) => {
    const ready = path.join(home, "stale-ready");
    const release = path.join(home, "release-stale");
    const stale = spawn(process.execPath, ["--input-type=module", "-e", childScript], {
      env: writerEnv(home, "stale", 1000, { READY_FILE: ready, WAIT_FILE: release }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    stale.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const staleFinished = new Promise((resolve, reject) => {
      stale.once("error", reject);
      stale.once("exit", (code) => resolve(code));
    });
    try {
      await waitForFile(ready); // stale process has read the old canonical state
      const newer = spawnSync(process.execPath, ["--input-type=module", "-e", childScript], {
        env: writerEnv(home, "newer", 2000), encoding: "utf8", timeout: 15000
      });
      assert.equal(newer.status, 0, newer.stderr);
      await fs.writeFile(release, "go"); // only now let the stale process persist
      const code = await staleFinished;
      assert.notEqual(code, 0, "stale writer must fail closed rather than overwrite");
      assert.match(stderr, /refusing stale overwrite/i);
      const persisted = JSON.parse(await fs.readFile(path.join(home, ".xtension", "state.json"), "utf8"));
      assert.ok(
        persisted.lastSyncAt >= 2000 && persisted.snapshot.preferences?.newer,
        "E216 stale writer regressed canonical timestamp and discarded newer state: " +
          JSON.stringify(persisted)
      );
    } finally {
      stale.kill();
    }
  });
});

test("cross-process write lock refuses a competing writer without touching canonical state", async () => {
  await isolatedHome(async (home) => {
    const dir = path.join(home, ".xtension");
    const lockDir = path.join(dir, "state.json.lock");
    await fs.mkdir(lockDir);
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", childScript], {
      env: writerEnv(home, "blocked", 2000), encoding: "utf8", timeout: 15000
    });
    assert.notEqual(result.status, 0, "writer must fail while lock exists");
    assert.match(result.stderr, /holds the state write lock/i);
    await assert.rejects(fs.access(path.join(dir, "state.json")), { code: "ENOENT" });
    await fs.rmdir(lockDir);
  });
});

test("equal-timestamp stale snapshot cannot replace a distinct canonical revision", async () => {
  await isolatedHome(async (home) => {
    const ready = path.join(home, "equal-ready");
    const release = path.join(home, "release-equal");
    const stale = spawn(process.execPath, ["--input-type=module", "-e", childScript], {
      env: writerEnv(home, "stale", 2000, { READY_FILE: ready, WAIT_FILE: release }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    stale.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const staleFinished = new Promise((resolve, reject) => {
      stale.once("error", reject);
      stale.once("exit", (code) => resolve(code));
    });
    try {
      await waitForFile(ready);
      const newer = spawnSync(process.execPath, ["--input-type=module", "-e", childScript], {
        env: writerEnv(home, "newer", 2000), encoding: "utf8", timeout: 15000
      });
      assert.equal(newer.status, 0, newer.stderr);
      await fs.writeFile(release, "go");
      assert.notEqual(await staleFinished, 0, "equal timestamps do not imply identical revisions");
      assert.match(stderr, /refusing stale overwrite/i);
      const persisted = JSON.parse(await fs.readFile(path.join(home, ".xtension", "state.json"), "utf8"));
      assert.equal(persisted.lastSyncAt, 2000);
      assert.deepEqual(Object.keys(persisted.snapshot.preferences), ["newer"]);
    } finally {
      stale.kill();
    }
  });
});
