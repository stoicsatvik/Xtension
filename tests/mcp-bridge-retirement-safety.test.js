import { expect, it } from "vitest";
import { createBridgeStore } from "../mcp/src/state-store.mjs";
import { inspectCommandReplay, rememberCommandResult } from "../agent/mcp-command-cache.js";

// E233: These are protocol counterexamples, not an implementation of pruning.
// The browser currently retains receipts and intentionally fails closed at 100.
const payload = { extensionId: "a".repeat(32), verdict: "essential" };
const success = { ok: true, value: { verdict: "essential" } };

function fixture(clock) {
  return createBridgeStore({
    token: "local-test-token",
    initialState: { lastSyncAt: 0, snapshot: {} },
    now: () => clock.value,
    commandLeaseMs: 30_000,
    dedupeWindowMs: 60_000,
    persistSnapshot: async () => {}
  });
}

it("E233 counterexample: two leases of one command survive the first acknowledgement", async () => {
  const clock = { value: 1_000 };
  const server = fixture(clock);
  const response = server.enqueueCommand("set-verdict", payload, 2_000);
  const first = server.takeCommands()[0];
  expect(first).toBeDefined();
  clock.value += 30_001;
  const stale = server.takeCommands()[0];
  expect(stale.id).toBe(first.id);
  expect(server.completeCommand(first.id, success)).toBe(true);
  expect(await response).toEqual(success);

  // The server accepted the first receipt, but the second poll response was
  // already delivered. Pruning locally now would turn its ID into "missing".
  const journal = rememberCommandResult([], first.id, success, clock.value, 100, "fp");
  expect(inspectCommandReplay(journal, stale.id, "fp").state).toBe("replay");
  expect(inspectCommandReplay([], stale.id, "fp").state).toBe("missing");
});

it.fails("E233 UNMET: a server acknowledgement proves no stale lease exists", async () => {
  const clock = { value: 1_000 };
  const server = fixture(clock);
  const response = server.enqueueCommand("set-verdict", payload, 2_000);
  const first = server.takeCommands()[0];
  clock.value += 30_001;
  const second = server.takeCommands()[0];
  server.completeCommand(first.id, success);
  await response;
  // Deliberately false invariant: the second leased copy is already out.
  expect(second).toBeUndefined();
});

it("E233 counterexample: completion tombstones are not persisted across store recreation", async () => {
  const clock = { value: 1_000 };
  const firstStore = fixture(clock);
  const response = firstStore.enqueueCommand("set-verdict", payload, 2_000);
  const command = firstStore.takeCommands()[0];
  expect(firstStore.completeCommand(command.id, success)).toBe(true);
  await response;
  const restarted = fixture(clock);
  expect(restarted.completeCommand(command.id, success)).toBe(false);
  expect(restarted.takeCommands()).toEqual([]);
});

it.fails("E233 UNMET: acknowledgement survives bridge store recreation", async () => {
  const clock = { value: 1_000 };
  const server = fixture(clock);
  const response = server.enqueueCommand("set-verdict", payload, 2_000);
  const command = server.takeCommands()[0];
  server.completeCommand(command.id, success);
  await response;
  // Deliberately false invariant: there is no persisted retirement ledger.
  expect(fixture(clock).completeCommand(command.id, success)).toBe(true);
});
