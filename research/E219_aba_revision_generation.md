# E219: Durable generation identifiers reject ABA stale writers (2026-10-24)

## Hypothesis

E217 compares the full normalized logical state while holding a cross-process filesystem lock. That rejects ordinary stale writes, but it cannot distinguish an initial state A from a later state A reached through A -> B -> A. If the timestamp and snapshot are identical, a stale process can incorrectly pass the compare-and-swap check.

**Falsifiable safety invariant:** A process that read generation A must not write after another participating process commits B and then returns to the same logical state A, even if timestamps and snapshots match exactly.

## Red experiment (preserved)

The deterministic independent-process test `mcp/node-tests/experiments/aba-revision-generation.mjs` creates a disposable HOME and:
1. Persists snapshot A at timestamp 2000.
2. Starts a stale writer that reads A and waits at a file barrier.
3. Persists B at timestamp 2000 from another process.
4. Persists A again at timestamp 2000 from a fresh process.
5. Confirms the restored snapshot and timestamp are exactly equal to the first A.
6. Releases the stale writer and requires a conflict rather than overwrite.

Before the correction, the stale writer **succeeded**. [Expected-red GitHub Actions run 40101305487](https://github.com/stoicsatvik/Xtension/actions/runs/40101305487) failed at the explicit assertion `ABA stale writer unexpectedly succeeded`. This is a real reproduced defect, not a test harness syntax failure.

## Correction

- Every successful accepted revision is written with a fresh `revisionId` (random UUID).
- `readPersistedState()` retains the generation as non-enumerable metadata so its existing public JSON/state shape is unchanged.
- The locked compare-and-swap checks both the generation and normalized logical state.
- Legacy canonical files without `revisionId` remain readable and gain a generation on the next successful write.
- A malformed persisted `revisionId` is rejected rather than silently reset.
- In-process ordered writes, crash locks, and existing HTTP 409 conflict handling are retained.

A fresh UUID per accepted revision makes same-content cycles distinguishable with overwhelming probability under participating writers. It does not prevent an adversary from manually replacing the entire canonical file with old bytes, nor does it supply an append-only audit log.

## Validation

After the correction, [E219 green run 40101347672](https://github.com/stoicsatvik/Xtension/actions/runs/40101347672) passed the original ABA regression, inherited E217 two-process tests, E218 SIGKILL crash tests, E213–E215 persistence regressions, and syntax validation.

Additional E219 regressions verify legacy file migration and malformed generation rejection. The final exact-head workflow should be checked after the documentation and test commits.

## Boundaries

All tests use disposable HOME directories and local Node processes. No real Chrome extension, user state file, or production service was changed. Filesystem lock cleanup remains supervised. No fsync or directory fsync is implemented; power-loss durability and adversarial file rollback are unproven. No merge is requested.

**Next:** test power-loss durability using fsync-backed writes and directory metadata synchronization under a fault-injection harness, with explicit platform-specific limits. Separately test that the live bridge client handles HTTP 409 without discarding unsynced evidence.
