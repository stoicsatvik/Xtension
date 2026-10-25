import { test } from "node:test";
import assert from "node:assert/strict";
import { createRetirementEpochModel } from "../research/e234_retirement_epoch_model.mjs";
import { inspectCommandReplay, rememberCommandIntent } from "../agent/mcp-command-cache.js";

function fixture() {
  const durable = new Map();
  const clock = { value: 1_000 };
  const restart = () => createRetirementEpochModel(durable, clock);
  return { durable, clock, restart, server: restart() };
}

test("E234: lease epoch rejects stale acknowledgement after a second lease", () => {
  const { server, clock } = fixture();
  assert.equal(server.enqueue("C"), true);
  const first = server.lease("C");
  clock.value += 30_001;
  const second = server.lease("C");
  assert.ok(second.epoch > first.epoch);
  assert.equal(server.acknowledge(first), false);
  assert.equal(server.acknowledge(second), true);
  assert.equal(server.inspect("C").status, "retired");
});

test("E234: committed tombstone survives modeled server restart and blocks new leases", () => {
  const { server, restart } = fixture();
  server.enqueue("C");
  const ticket = server.lease("C");
  assert.throws(() => server.acknowledge(ticket, { crashAt: "after-commit" }), /simulated crash/);
  const recovered = restart();
  assert.equal(recovered.inspect("C").status, "retired");
  assert.equal(recovered.lease("C"), null);
  assert.equal(recovered.enqueue("C"), false);
  assert.equal(recovered.acknowledge(ticket), false);
});

test("E234: crash before tombstone leaves a lease, but actual pending browser intent blocks replay", () => {
  const { server, restart, clock } = fixture();
  server.enqueue("C");
  const ticket = server.lease("C");
  const journal = rememberCommandIntent([], ticket.id, "identity-fp", clock.value);
  let browserMutations = 1; // First mutation already happened; receipt did not complete.
  assert.throws(() => server.acknowledge(ticket, { crashAt: "before-commit" }), /simulated crash/);
  clock.value += 30_001;
  const redelivery = restart().lease("C");
  assert.equal(inspectCommandReplay(journal, redelivery.id, "identity-fp").state, "pending");
  // The pending intent forces reconciliation instead of a second mutation.
  assert.equal(browserMutations, 1);
});

test("E234 NEGATIVE: durable retirement cannot recall an already-delivered lease after receipt pruning", () => {
  const { server, clock } = fixture();
  server.enqueue("C");
  const first = server.lease("C");
  clock.value += 30_001;
  const alreadyDelivered = server.lease("C");
  assert.equal(server.acknowledge(alreadyDelivered), true);
  assert.equal(server.inspect("C").status, "retired");
  // Hypothetical unsafe prune. The stale copy was issued before retirement.
  const browserReceiptsAfterPrune = [];
  let browserMutations = 1;
  assert.equal(inspectCommandReplay(browserReceiptsAfterPrune, first.id, "identity-fp").state, "missing");
  browserMutations += 1; // A naive offline worker treats missing as new.
  assert.equal(browserMutations, 2); // Counterexample, NOT a desired invariant.
});

test("E234: preflight rejects a stale lease if retirement happened before the check", () => {
  const { server } = fixture();
  server.enqueue("C");
  const ticket = server.lease("C");
  assert.equal(server.acknowledge(ticket), true);
  assert.equal(server.authorize(ticket), false);
});

test("E234 NEGATIVE: successful preflight is TOCTOU-vulnerable if retirement interleaves before browser mutation", () => {
  const { server } = fixture();
  server.enqueue("C");
  const ticket = server.lease("C");
  assert.equal(server.authorize(ticket), true);
  // Another context completes/retire after this check, before the write.
  assert.equal(server.acknowledge(ticket), true);
  let browserMutationsAfterRetirement = 0;
  browserMutationsAfterRetirement += 1; // Browser's already-authorized async write commits.
  assert.equal(server.authorize(ticket), false);
  assert.equal(browserMutationsAfterRetirement, 1); // Negative counterexample.
});
