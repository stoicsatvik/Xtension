import assert from "node:assert/strict";
import test from "node:test";
import { createBridgeStore } from "../../src/state-store.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function snapshot(verdict) {
  return { preferences: { abc: { verdict } } };
}

test("pending successful sync is invisible to readers and status until commit", async () => {
  const gate = deferred();
  const started = deferred();
  const store = createBridgeStore({
    token: "e221-test",
    initialState: { lastSyncAt: 101, snapshot: snapshot("essential") },
    now: () => 202,
    persistSnapshot: async () => { started.resolve(); await gate.promise; }
  });
  const update = store.updateSnapshot(snapshot("unnecessary"));
  await started.promise;
  try {
    assert.deepEqual(store.state.snapshot, snapshot("essential"));
    assert.equal(store.state.lastSyncAt, 101);
    assert.equal(store.compactStatus().lastSyncAt, 101);
  } finally {
    gate.resolve();
  }
  await update;
  assert.deepEqual(store.state.snapshot, snapshot("unnecessary"));
  assert.equal(store.state.lastSyncAt, 202);
});

test("pending rejected sync is never observable, before or after rejection", async () => {
  const gate = deferred();
  const started = deferred();
  const store = createBridgeStore({
    token: "e221-test",
    initialState: { lastSyncAt: 101, snapshot: snapshot("essential") },
    now: () => 202,
    persistSnapshot: async () => { started.resolve(); await gate.promise; throw new Error("injected conflict"); }
  });
  const update = store.updateSnapshot(snapshot("unnecessary"));
  await started.promise;
  try {
    assert.deepEqual(store.state.snapshot, snapshot("essential"));
    assert.equal(store.compactStatus().lastSyncAt, 101);
  } finally {
    gate.resolve();
  }
  await assert.rejects(update, /injected conflict/);
  assert.deepEqual(store.state.snapshot, snapshot("essential"));
  assert.equal(store.state.lastSyncAt, 101);
});

test("queued syncs publish each revision only after its own successful commit", async () => {
  const firstGate = deferred();
  const secondGate = deferred();
  const firstStarted = deferred();
  const secondStarted = deferred();
  let attempts = 0;
  const store = createBridgeStore({
    token: "e221-test",
    initialState: { lastSyncAt: 101, snapshot: snapshot("essential") },
    now: (() => { let n = 200; return () => ++n; })(),
    persistSnapshot: async () => {
      if (++attempts === 1) { firstStarted.resolve(); await firstGate.promise; }
      else { secondStarted.resolve(); await secondGate.promise; }
    }
  });
  const first = store.updateSnapshot(snapshot("optional"));
  const second = store.updateSnapshot(snapshot("unnecessary"));
  await firstStarted.promise;
  assert.deepEqual(store.state.snapshot, snapshot("essential"));
  firstGate.resolve();
  await first;
  await secondStarted.promise;
  try {
    assert.deepEqual(store.state.snapshot, snapshot("optional"));
    assert.equal(store.state.lastSyncAt, 201);
  } finally {
    secondGate.resolve();
  }
  await second;
  assert.deepEqual(store.state.snapshot, snapshot("unnecessary"));
  assert.equal(store.state.lastSyncAt, 202);
});

test("command deduplication changes at commit, not at uncommitted acceptance", async () => {
  const gate = deferred();
  const started = deferred();
  const store = createBridgeStore({
    token: "e221-test",
    initialState: { lastSyncAt: 101, snapshot: snapshot("essential") },
    persistSnapshot: async () => { started.resolve(); await gate.promise; }
  });
  const payload = { extensionId: "abc", verdict: "essential" };
  const original = store.enqueueCommand("set-verdict", payload, 2000);
  const [leased] = store.takeCommands();
  store.completeCommand(leased.id, { ok: true });
  await original;
  assert.deepEqual(await store.enqueueCommand("set-verdict", payload, 2000), { ok: true });
  const update = store.updateSnapshot(snapshot("unnecessary"));
  await started.promise;
  try {
    assert.deepEqual(await store.enqueueCommand("set-verdict", payload, 2000), { ok: true });
    assert.equal(store.commands.length, 0);
  } finally {
    gate.resolve();
  }
  await update;
  const afterCommit = store.enqueueCommand("set-verdict", payload, 2000);
  assert.equal(store.commands.length, 1, "committed state change must invalidate cached command result");
  const [next] = store.takeCommands();
  store.completeCommand(next.id, { ok: true });
  await afterCommit;
});
