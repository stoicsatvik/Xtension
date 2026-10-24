import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// E219: A -> B -> A with the same logical state and timestamp must not
// authorize a writer that observed the first A. This is an ABA counterexample.
const moduleUrl = new URL("../../src/state-store.mjs", import.meta.url).href;
const childScript = `
  import fs from "node:fs/promises";
  import { createBridgeStore, readPersistedState } from ${JSON.stringify(moduleUrl)};
  const initialState = await readPersistedState();
  if (process.env.READY_FILE) {
    await fs.writeFile(process.env.READY_FILE, "ready");
    for (let i = 0; i < 500; i++) {
      try { await fs.access(process.env.RELEASE_FILE); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
      if (i === 499) throw new Error("barrier timed out");
    }
  }
  const store = createBridgeStore({
    token: "e219-isolated",
    initialState,
    now: () => 2000
  });
  await store.updateSnapshot({
    preferences: { [process.env.WRITER_ID]: { verdict: "essential" } }
  });
`;

function writer(home, id, extra = {}) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", childScript], {
    env: { ...process.env, HOME: home, WRITER_ID: id, ...extra },
    encoding: "utf8",
    timeout: 15000
  });
}

test("E219 stale A writer must be rejected after another writer commits A -> B -> A", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "xtension-e219-"));
  const file = path.join(home, ".xtension", "state.json");
  const ready = path.join(home, "ready");
  const release = path.join(home, "release");
  let stale;
  try {
    const initial = writer(home, "A");
    assert.equal(initial.status, 0, initial.stderr);
    const original = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(original.lastSyncAt, 2000);

    stale = spawn(process.execPath, ["--input-type=module", "-e", childScript], {
      env: { ...process.env, HOME: home, WRITER_ID: "STALE", READY_FILE: ready, RELEASE_FILE: release },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    stale.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const finished = new Promise((resolve, reject) => {
      stale.once("error", reject);
      stale.once("exit", (code) => resolve(code));
    });
    for (let i = 0; i < 500; i++) {
      try { await fs.access(ready); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
      if (i === 499) throw new Error("stale reader did not reach barrier");
    }

    const changed = writer(home, "B");
    assert.equal(changed.status, 0, changed.stderr);
    const restored = writer(home, "A");
    assert.equal(restored.status, 0, restored.stderr);
    const before = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(before.lastSyncAt, original.lastSyncAt);
    assert.deepEqual(before.snapshot, original.snapshot,
      "ABA must restore the same logical content, not merely a similar state");

    await fs.writeFile(release, "go");
    const code = await finished;
    assert.notEqual(code, 0, "ABA stale writer unexpectedly succeeded");
    assert.match(stderr, /refusing stale overwrite/i);
    const after = JSON.parse(await fs.readFile(file, "utf8"));
    assert.deepEqual(after, before, "stale writer must not mutate canonical revision");
  } finally {
    stale?.kill();
    await fs.rm(home, { recursive: true, force: true });
  }
});


test("E219 legacy canonical file upgrades to a durable generation on first write", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "xtension-e219-legacy-"));
  const file = path.join(home, ".xtension", "state.json");
  try {
    await fs.mkdir(path.dirname(file));
    await fs.writeFile(file, JSON.stringify({ lastSyncAt: 1000, snapshot: { preferences: { legacy: { verdict: "essential" } } } }));
    const first = writer(home, "A");
    assert.equal(first.status, 0, first.stderr);
    const a = JSON.parse(await fs.readFile(file, "utf8"));
    assert.match(a.revisionId, /^[0-9a-f-]{36}$/i);
    const second = writer(home, "A");
    assert.equal(second.status, 0, second.stderr);
    const b = JSON.parse(await fs.readFile(file, "utf8"));
    assert.deepEqual(a.snapshot, b.snapshot);
    assert.notEqual(a.revisionId, b.revisionId, "same-content writes require distinct generations");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("E219 malformed persisted revisionId fails closed and preserves canonical bytes", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "xtension-e219-invalid-"));
  const file = path.join(home, ".xtension", "state.json");
  try {
    await fs.mkdir(path.dirname(file));
    const malformed = JSON.stringify({ lastSyncAt: 1000, snapshot: {}, revisionId: { attacker: "invalid" } });
    await fs.writeFile(file, malformed);
    const result = writer(home, "A");
    assert.notEqual(result.status, 0, "invalid revisionId must not be silently accepted");
    assert.match(result.stderr, /invalid.*persisted state|persisted revisionId/i);
    assert.equal(await fs.readFile(file, "utf8"), malformed);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
