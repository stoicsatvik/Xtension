import { test } from "node:test";
import assert from "node:assert/strict";
import { crashWorld, recover, crashCutMatrix } from "../research/e264_crash_reconciliation_model.mjs";

const before = () => crashWorld({ effectCommitted: false });
const after = () => crashWorld({ effectCommitted: true });

test("E264: two different effect histories have indistinguishable durable server/browser state", () => {
  const a = before();
  const b = after();
  assert.deepEqual(a.visible, b.visible);
  assert.equal(a.visible.replay, "pending");
  assert.equal(a.effects, 0);
  assert.equal(b.effects, 1);
});

test("E264 NEGATIVE: retry after pending intent duplicates an already committed effect", () => {
  assert.equal(recover(before(), "retry").effects, 1);
  assert.equal(recover(after(), "retry").effects, 2);
  assert.equal(recover(after(), "retry").duplicated, true);
});

test("E264 NEGATIVE: skip after pending intent loses an effect not yet committed", () => {
  assert.equal(recover(before(), "skip").effects, 0);
  assert.equal(recover(after(), "skip").effects, 1);
  assert.equal(recover(before(), "skip").lost, true);
});

test("E264: fail-closed halt avoids duplicates but does not guarantee eventual completion", () => {
  assert.equal(recover(before(), "halt").effects, 0);
  assert.equal(recover(after(), "halt").effects, 1);
  assert.equal(recover(after(), "halt").duplicated, false);
});

test("E264: exhaustive deterministic recovery-policy matrix has no unconditional exactly-once policy", () => {
  const matrix = crashCutMatrix();
  assert.equal(matrix.length, 3);
  assert.deepEqual(matrix.map(row => [row.policy, row.outcomes.map(o => o.effects)]), [
    ["retry", [1, 2]], ["skip", [0, 1]], ["halt", [0, 1]]
  ]);
  assert.equal(matrix.filter(row => row.guaranteesExactlyOnce).length, 0);
});

test("E264 CONTROL: effect-boundary atomic dedup makes retry safe in both histories", () => {
  assert.equal(recover(before(), "retry", { atomicEffectDedup: true }).effects, 1);
  assert.equal(recover(after(), "retry", { atomicEffectDedup: true }).effects, 1);
});

test("E264: malformed model inputs are rejected rather than treated as safe", () => {
  assert.throws(() => crashWorld({ effectCommitted: 1 }), TypeError);
  assert.throws(() => recover(before(), "unknown"), RangeError);
});
