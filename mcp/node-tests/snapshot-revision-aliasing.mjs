import assert from "node:assert/strict";
import test from "node:test";
import { createBridgeStore } from "../src/state-store.mjs";

// E214: a queued revision must be a value snapshot, not an alias of caller data.
test("queued persistence retains the accepted value after caller mutation", async () => {
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const persisted = [];
  const store = createBridgeStore({
    token: "test-token",
    initialState: { lastSyncAt: 0, snapshot: {} },
    persistSnapshot: async (revision) => {
      persisted.push(structuredClone(revision.snapshot));
      if (persisted.length === 1) await gate;
    }
  });
  const first = store.updateSnapshot({ preferences: { abc: { verdict: "first" } } });
  const input = { preferences: { abc: { verdict: "accepted" } } };
  const second = store.updateSnapshot(input);
  input.preferences.abc.verdict = "mutated-after-acceptance";
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(persisted.length, 1, "second revision must remain queued");
  } finally {
    releaseFirst();
  }
  await Promise.all([first, second]);
  assert.deepEqual(persisted.map((x) => x.preferences.abc.verdict),
    ["first", "accepted"]);
  assert.equal(store.state.snapshot.preferences.abc.verdict, "accepted");
});

test("queued persistence is isolated from mutations through committed live state", async () => {
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const persisted = [];
  const initialState = {
    lastSyncAt: 10,
    snapshot: { preferences: { abc: { verdict: "initial" } } }
  };
  const store = createBridgeStore({
    token: "test-token",
    initialState,
    persistSnapshot: async (revision) => {
      persisted.push(structuredClone(revision.snapshot));
      if (persisted.length === 1) await gate;
    }
  });
  const first = store.updateSnapshot({ preferences: { abc: { verdict: "first" } } });
  const second = store.updateSnapshot({ preferences: { abc: { verdict: "accepted" } } });
  // E221 keeps only committed state visible. Mutate that exposed committed
  // object while the two accepted revisions are queued, rather than assuming
  // the uncommitted second snapshot has already been published.
  store.state.snapshot.preferences.abc.verdict = "mutated-through-state";
  initialState.snapshot.preferences.abc.verdict = "mutated-through-caller";
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(persisted.length, 1);
  } finally {
    releaseFirst();
  }
  await Promise.all([first, second]);
  assert.deepEqual(persisted.map((x) => x.preferences.abc.verdict),
    ["first", "accepted"]);
  assert.equal(store.state.snapshot.preferences.abc.verdict, "accepted");
});
