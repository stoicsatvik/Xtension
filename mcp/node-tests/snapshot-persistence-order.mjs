import assert from "node:assert/strict";
import test from "node:test";
import { createBridgeStore } from "../src/state-store.mjs";

test("concurrent snapshot writes are serialized and persist immutable revisions", async () => {
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const writes = [];
  const store = createBridgeStore({
    token: "test-token",
    initialState: { lastSyncAt: 0, snapshot: {} },
    now: (() => { let t = 1000; return () => ++t; })(),
    persistSnapshot: async (state) => {
      writes.push({ lastSyncAt: state.lastSyncAt, snapshot: structuredClone(state.snapshot) });
      if (writes.length === 1) await gate;
    }
  });

  const first = store.updateSnapshot({ preferences: { abc: { verdict: "essential" } } });
  const second = store.updateSnapshot({ preferences: { abc: { verdict: "unnecessary" } } });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(writes.length, 1, "second persistence must await first");
  } finally {
    releaseFirst();
  }
  await Promise.all([first, second]);
  assert.deepEqual(writes.map((write) => write.snapshot.preferences.abc.verdict),
    ["essential", "unnecessary"]);
  assert.ok(writes[0].lastSyncAt < writes[1].lastSyncAt);
});

test("a failed snapshot write does not permanently block a later revision", async () => {
  let attempts = 0;
  const writes = [];
  const store = createBridgeStore({
    token: "test-token",
    initialState: { lastSyncAt: 0, snapshot: {} },
    persistSnapshot: async (state) => {
      attempts += 1;
      if (attempts === 1) throw new Error("simulated disk failure");
      writes.push(structuredClone(state.snapshot));
    }
  });
  await assert.rejects(store.updateSnapshot({ preferences: { abc: { verdict: "essential" } } }),
    /simulated disk failure/);
  await store.updateSnapshot({ preferences: { abc: { verdict: "optional" } } });
  assert.equal(attempts, 2);
  assert.equal(writes.at(-1).preferences.abc.verdict, "optional");
});
