# E216: Cross-process stale snapshot overwrite falsification (2026-10-24)

## Prior state and question

E213 serialized **in-process** snapshot writes; E214 cloned accepted revisions; E215 rejected corrupt canonical state. None coordinates two independent MCP bridge processes sharing `~/.xtension/state.json`. A process-specific temporary filename prevents temp-name collisions but does not prevent stale state from replacing a newer canonical revision.

**Falsifiable invariant:** Once a canonical snapshot with `lastSyncAt = 2000` and a `preferences.newer` entry has been persisted, a process that previously loaded the empty state must not replace it with a snapshot timestamped `1000` that omits the newer entry.

## Experiment

`mcp/node-tests/experiments/stale-process-overwrite.mjs` runs only against disposable HOME directories, using real filesystem writes and independent Node child processes.

1. Control: one process writes a snapshot at timestamp 2000, then the parent reloads and validates it.
2. Start process B; B reads the initial empty state and waits on a filesystem barrier.
3. Start process A; A writes the newer timestamp-2000 state and exits.
4. Release B; B writes its stale timestamp-1000 state.
5. Read the canonical file and require that its timestamp has not regressed and that A's entry remains.

The deterministic schedule is intentional: no reliance on a flaky simultaneous race. The second test is a **known-failing falsification probe**, not part of the default `npm test` glob. The E216 workflow explicitly requires the *specific* failure signature while running the prior E213-E215 regressions normally. CI success therefore means the counterexample was reproduced, **not** that the production invariant is satisfied.

## Observed result (exact-head CI)

At commit `12a37a15e63402d69c11bd0db0f093b25ff8c77b`, [GitHub Actions run 40088829460](https://github.com/stoicsatvik/Xtension/actions/runs/40088829460) reproduced the predicted failure on a real disposable filesystem:

- **Control:** 1/1 passed. One writer persisted and reloaded timestamp 2000.
- **Stale-process invariant:** 0/1 passed. Canonical file ended with `{"lastSyncAt":1000,"snapshot":{"preferences":{"stale":{"verdict":"essential"}}}}`. The newer entry was gone.
- **Existing E213-E215 regression suite:** 8/8 passed.
- **Syntax checks:** passed.
- The E216 workflow succeeded only because it **explicitly expects and verifies this exact red counterexample**. This is not a green fix.

This is a deterministic counterexample to cross-process monotonicity, not a statistical failure rate or evidence of exploitation.

## Interpretation and safety

A stale process overwriting the newer state is evidence of an uncoordinated multi-process last-writer-wins defect. It is not proof of data loss on any real user's machine. This test does not touch the live home directory, Chrome extensions, network services, or a production bridge.

**Do not merge this test as a claim of correctness.** Next engineering choice: compare single-writer process ownership (with explicit crash recovery) against an inter-process lock plus revision check held across read/validate/write/rename. The latter needs deterministic simultaneous-writer tests, stale-lock recovery tests, and careful semantics for multiple independent Chrome clients. No unsafe automatic lock breaking or production rollout is warranted yet.
