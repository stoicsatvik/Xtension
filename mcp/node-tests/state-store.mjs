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
