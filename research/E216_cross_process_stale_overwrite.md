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

## Expected interpretation and safety

A stale process overwriting the newer state is evidence of an uncoordinated multi-process last-writer-wins defect. It is not proof of data loss on any real user's machine. This test does not touch the live home directory, Chrome extensions, network services, or a production bridge.

**Do not merge this test as a claim of correctness.** Next engineering choice: compare single-writer process ownership (with explicit crash recovery) against an inter-process lock plus revision check held across read/validate/write/rename. The latter needs deterministic simultaneous-writer tests, stale-lock recovery tests, and careful semantics for multiple independent Chrome clients. No unsafe automatic lock breaking or production rollout is warranted yet.
