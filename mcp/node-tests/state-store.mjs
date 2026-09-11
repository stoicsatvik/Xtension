import assert from "node:assert/strict";
import test from "node:test";
import { createBridgeStore } from "../src/state-store.mjs";

test("bridge snapshot keeps only approved local evidence keys", async () => {
  const store = createBridgeStore({ token: "test-token", initialState: { lastSyncAt: 0, snapshot: {} } });
  await store.updateSnapshot({
    inventory: { extensions: [{ id: "abc", name: "Example" }] },
    preferences: { abc: { verdict: "essential" } },
    rawHistory: [{ url: "https://private.example" }]
  });

  assert.equal(store.state.snapshot.inventory.extensions.length, 1);
  assert.equal(store.state.snapshot.preferences.abc.verdict, "essential");
  assert.equal("rawHistory" in store.state.snapshot, false);
});

test("command queue resolves only after agent result", async () => {
  const store = createBridgeStore({ token: "test-token", initialState: { lastSyncAt: 0, snapshot: {} } });
  const pending = store.enqueueCommand("start-trial", { extensionId: "abc", days: 7 }, 1000);
  const [command] = store.takeCommands();

  assert.equal(command.type, "start-trial");
  assert.equal(command.payload.days, 7);
  assert.equal(store.completeCommand(command.id, { ok: true, trial: { active: true } }), true);
  assert.deepEqual(await pending, { ok: true, trial: { active: true } });
});

test("leased commands are redelivered only after the lease expires", async () => {
  let clock = 10_000;
  const store = createBridgeStore({
    token: "test-token",
    initialState: { lastSyncAt: 0, snapshot: {} },
    now: () => clock,
    commandLeaseMs: 5_000
  });
  const pending = store.enqueueCommand("restore-extension", { extensionId: "abc" }, 1000);
  pending.catch(() => {});

  const [first] = store.takeCommands();
  assert.ok(first?.id);
  assert.equal(store.takeCommands().length, 0);

  clock += 5_001;
  const [redelivered] = store.takeCommands();
  assert.equal(redelivered.id, first.id);
  store.completeCommand(first.id, { ok: true });
  assert.deepEqual(await pending, { ok: true });
});

test("retrying an in-flight action reuses the same command", async () => {
  const store = createBridgeStore({ token: "test-token", initialState: { lastSyncAt: 0, snapshot: {} } });
  const firstPending = store.enqueueCommand("start-trial", { extensionId: "abc", days: 7 }, 1000);
  const secondPending = store.enqueueCommand("start-trial", { days: 7, extensionId: "abc" }, 1000);
  const [command] = store.takeCommands();

  assert.equal(store.commands.length, 1);
  store.completeCommand(command.id, { ok: true, value: "done" });
  assert.deepEqual(await firstPending, { ok: true, value: "done" });
  assert.deepEqual(await secondPending, { ok: true, value: "done" });
});

test("recently completed identical actions return the cached result", async () => {
  let clock = 50_000;
  const store = createBridgeStore({
    token: "test-token",
    initialState: { lastSyncAt: 0, snapshot: {} },
    now: () => clock,
    dedupeWindowMs: 60_000
  });
  const firstPending = store.enqueueCommand("set-verdict", { extensionId: "abc", verdict: "optional" }, 1000);
  const [command] = store.takeCommands();
  store.completeCommand(command.id, { ok: true, verdict: "optional" });
  await firstPending;

  clock += 20_000;
  const retryResult = await store.enqueueCommand("set-verdict", { verdict: "optional", extensionId: "abc" }, 1000);
  assert.deepEqual(retryResult, { ok: true, verdict: "optional" });
  assert.equal(store.commands.length, 0);
  assert.equal(store.completeCommand(command.id, { ok: true, verdict: "optional" }), true);
});
