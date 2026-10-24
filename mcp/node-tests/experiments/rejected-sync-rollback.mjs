import assert from "node:assert/strict";
import test from "node:test";
import { createBridgeStore } from "../../src/state-store.mjs";

// E220: a rejected /v1/sync must not leave a fictitious new in-memory
// snapshot visible to MCP readers after the persistence promise rejects.
test("rejected first sync restores the last committed state", async () => {
  const initialState = {
    lastSyncAt: 101,
    snapshot: { preferences: { abc: { verdict: "essential" } } }
  };
  const store = createBridgeStore({
    token: "e220-isolated",
    initialState,
    now: () => 202,
    persistSnapshot: async () => {
      throw new Error("simulated E220 disk rejection");
    }
  });

  await assert.rejects(
    store.updateSnapshot({ preferences: { abc: { verdict: "unnecessary" } } }),
    /simulated E220 disk rejection/
  );
  assert.equal(store.state.lastSyncAt, 101, "rejected sync must not advance visible time");
  assert.deepEqual(store.state.snapshot, initialState.snapshot,
    "rejected sync must not replace the last committed evidence");
});

test("failed later revision restores the preceding successfully persisted revision", async () => {
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const persisted = [];
  const store = createBridgeStore({
    token: "e220-isolated",
    initialState: { lastSyncAt: 0, snapshot: {} },
    now: (() => { let clock = 1000; return () => ++clock; })(),
    persistSnapshot: async (revision) => {
      if (persisted.length === 0) {
        persisted.push(structuredClone(revision));
        await gate;
        return;
      }
      throw new Error("simulated second-write rejection");
    }
  });

  const first = store.updateSnapshot({ preferences: { abc: { verdict: "essential" } } });
  const second = store.updateSnapshot({ preferences: { abc: { verdict: "unnecessary" } } });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(persisted.length, 1);
  } finally {
    releaseFirst();
  }
  await first;
  await assert.rejects(second, /simulated second-write rejection/);
  assert.equal(store.state.lastSyncAt, persisted[0].lastSyncAt);
  assert.deepEqual(store.state.snapshot, persisted[0].snapshot);
});

test("a rejected revision does not prevent a later successful revision", async () => {
  let attempts = 0;
  const store = createBridgeStore({
    token: "e220-isolated",
    initialState: { lastSyncAt: 0, snapshot: {} },
    persistSnapshot: async () => {
      if (++attempts === 1) throw new Error("simulated one-shot rejection");
    }
  });
  await assert.rejects(store.updateSnapshot({ preferences: { abc: { verdict: "essential" } } }),
    /simulated one-shot rejection/);
  await store.updateSnapshot({ preferences: { abc: { verdict: "optional" } } });
  assert.equal(attempts, 2);
  assert.equal(store.state.snapshot.preferences.abc.verdict, "optional");
});

test("an older rejected write cannot roll back a newer queued successful snapshot", async () => {
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  let attempts = 0;
  const store = createBridgeStore({
    token: "e220-isolated",
    initialState: { lastSyncAt: 0, snapshot: {} },
    now: (() => { let clock = 500; return () => ++clock; })(),
    persistSnapshot: async () => {
      if (++attempts === 1) {
        await gate;
        throw new Error("older queued write rejected");
      }
    }
  });
  const older = store.updateSnapshot({ preferences: { abc: { verdict: "essential" } } });
  const newer = store.updateSnapshot({ preferences: { abc: { verdict: "optional" } } });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(attempts, 1);
  } finally {
    releaseFirst();
  }
  await assert.rejects(older, /older queued write rejected/);
  await newer;
  assert.equal(attempts, 2);
  assert.equal(store.state.lastSyncAt, 502);
  assert.equal(store.state.snapshot.preferences.abc.verdict, "optional");
});
