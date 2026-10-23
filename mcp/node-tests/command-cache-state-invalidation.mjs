import assert from "node:assert/strict";
import test from "node:test";
import { createBridgeStore } from "../src/state-store.mjs";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const payload = { extensionId };
const noDisk = async () => {};

function storeAt(snapshot = {}) {
  let clock = 1_000;
  const store = createBridgeStore({
    token: "test-token",
    initialState: { lastSyncAt: 0, snapshot },
    now: () => clock,
    dedupeWindowMs: 60_000,
    persistSnapshot: noDisk
  });
  return { store, advance: (ms) => { clock += ms; } };
}

test("observed extension state reversal invalidates a successful restore result", async () => {
  const { store, advance } = storeAt({
    inventory: { extensions: [{ id: extensionId, enabled: false }] }
  });
  const first = store.enqueueCommand("restore-extension", payload, 1_000);
  const [oldCommand] = store.takeCommands();
  store.completeCommand(oldCommand.id, { ok: true, value: { enabled: true } });
  await first;

  await store.updateSnapshot({
    inventory: { extensions: [{ id: extensionId, enabled: true }] }
  });
  await store.updateSnapshot({
    inventory: { extensions: [{ id: extensionId, enabled: false }] }
  });
  advance(1_000);

  const second = store.enqueueCommand("restore-extension", payload, 1_000);
  assert.equal(store.commands.length, 1);
  const [newCommand] = store.takeCommands();
  assert.notEqual(newCommand.id, oldCommand.id);
  store.completeCommand(newCommand.id, { ok: true, value: { enabled: true } });
  assert.deepEqual(await second, { ok: true, value: { enabled: true } });
});

test("failed command is never memoized as a successful completion", async () => {
  const { store } = storeAt();
  const first = store.enqueueCommand("start-trial", { ...payload, days: 7 }, 1_000);
  const [oldCommand] = store.takeCommands();
  store.completeCommand(oldCommand.id, { ok: false, error: "temporary worker error" });
  assert.equal((await first).ok, false);

  const retry = store.enqueueCommand("start-trial", { ...payload, days: 7 }, 1_000);
  assert.equal(store.commands.length, 1);
  const [newCommand] = store.takeCommands();
  assert.notEqual(newCommand.id, oldCommand.id);
  store.completeCommand(newCommand.id, { ok: true });
  assert.deepEqual(await retry, { ok: true });
});

test("timestamp-only snapshot refresh does not invalidate a completed result", async () => {
  const { store } = storeAt({
    inventory: { observedAt: 1, extensions: [{ id: extensionId, enabled: true }] }
  });
  const first = store.enqueueCommand("restore-extension", payload, 1_000);
  const [command] = store.takeCommands();
  store.completeCommand(command.id, { ok: true });
  await first;

  await store.updateSnapshot({
    inventory: { observedAt: 2, extensions: [{ id: extensionId, enabled: true }] },
    timeline: [{ at: 2, event: "unrelated" }]
  });
  assert.deepEqual(await store.enqueueCommand("restore-extension", payload, 1_000), { ok: true });
  assert.equal(store.commands.length, 0);
});

test("changed local verdict invalidates cached set-verdict result", async () => {
  const { store } = storeAt({ preferences: { [extensionId]: { verdict: "essential" } } });
  const first = store.enqueueCommand("set-verdict", { ...payload, verdict: "optional" }, 1_000);
  const [oldCommand] = store.takeCommands();
  store.completeCommand(oldCommand.id, { ok: true });
  await first;

  await store.updateSnapshot({ preferences: { [extensionId]: { verdict: "unnecessary" } } });
  const retry = store.enqueueCommand("set-verdict", { ...payload, verdict: "optional" }, 1_000);
  assert.equal(store.commands.length, 1);
  const [newCommand] = store.takeCommands();
  assert.notEqual(newCommand.id, oldCommand.id);
  store.completeCommand(newCommand.id, { ok: true });
  assert.deepEqual(await retry, { ok: true });
});
