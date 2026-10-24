# E214: Queued snapshot revision aliasing (2026-10-24)

## Falsifiable question

E213 serialized local MCP bridge snapshot writes and captured a top-level revision
object. Is that enough to guarantee that the snapshot written to disk is the
nested value accepted by `updateSnapshot`, even if a caller or another
consumer mutates an object while an earlier disk write is blocked?

**Prediction before patch:** No. `sanitizeSnapshot` only copies top-level
properties, so both the accepted live state and the queued revision share
nested objects with caller input. The revision also shares the live state's
nested objects.

## Reproduction and preserved negative result

A deterministic fake persistence callback blocks the first write. A second
snapshot is accepted and queued; the test then mutates either the caller-owned
input or `store.state.snapshot` before releasing the first write.

- Initial implementation: **0/2 E214 tests passed**.
- Test 1 persisted `mutated-after-acceptance` instead of `accepted`.
- Test 2 persisted `mutated-through-state` instead of `accepted`.
- The original failing run is [40080913725](https://github.com/stoicsatvik/Xtension/actions/runs/40080913725).
- The red phase is deliberately preserved in Git history. It demonstrates a
  real in-process aliasing bug; it does not demonstrate a remote exploit.

## Correction

`createBridgeStore.updateSnapshot` now deep-copies the sanitized input
before assigning it to live state and separately deep-copies that accepted
state for the queued disk revision. E213's ordered, failure-recovering write
queue remains unchanged. The original E213 tests still run.

- Corrected E214 tests: **2/2 passed**.
- Original E213 tests: **2/2 passed**.
- Node state-store syntax check: passed.
- First corrected CI run: [40080950811](https://github.com/stoicsatvik/Xtension/actions/runs/40080950811), SUCCESS.

## Scope and limitations

The test uses a fake persistence callback and controlled Promise scheduling,
not Chrome or a real filesystem. The fix isolates accepted snapshots from
in-process mutation but does **not** provide a transactional multi-process
store, a durable fsync guarantee, or protection from power loss between
writing and renaming a temporary file. JSON snapshot size remains subject to
the existing local bridge request limit; no production data was accessed.

**Next falsification:** Crash/restart tests for temporary-file cleanup,
multi-process simultaneous writers, and recovery from a partially written or
corrupted persisted state. No live browser extension changes, deployment,
external outreach or merge.
