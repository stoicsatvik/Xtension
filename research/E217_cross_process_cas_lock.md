# E217: Fail-closed cross-process snapshot compare-and-swap (2026-10-24)

## Continuation of E216

E216 established a deterministic counterexample: two independent Node processes loaded the same empty state; A persisted a newer revision at timestamp 2000, then B persisted its stale revision at 1000. The final canonical file contained B's data, losing A's entry. The exact negative result and the intentionally expected-red CI are preserved on E216 PR #9 and in `research/E216_cross_process_stale_overwrite.md`.

**Hypothesis:** An atomic filesystem lock around *read, revision comparison, temporary-file write, and rename* will prevent participating processes from silently replacing a canonical state that differs from their last successfully persisted revision. Checking the full revision must also reject equal-timestamp but unequal snapshots.

## Minimal change

- Use `mkdir(~/.xtension/state.json.lock)` as an exclusive cross-process write guard. An existing lock is a hard conflict, not an invitation to overwrite.
- Under the lock, re-read the canonical file and compare it to the writer's expected last-successful revision. If the state differs, reject before writing any temporary or canonical file.
- Advance the writer's expected revision **only after successful persistence**, maintaining E213's in-process queue semantics and E214's immutable revisions.
- Return HTTP 409 on write-lock or stale-revision conflicts. Corrupt canonical state remains fail-closed under E215.
- Remove a lock on ordinary completion/failure, but **never automatically break an abandoned lock**. Manual recovery must first establish that no writer is alive.

## Falsifiable regression protocol

Run `node --test mcp/node-tests/experiments/stale-process-overwrite.mjs` under disposable HOME directories, with real independent Node processes:

1. One-process write and reload still succeeds.
2. Stale process B loads empty state, process A commits timestamp 2000, B attempts timestamp 1000. B must exit nonzero with a specific stale-overwrite refusal, and A's canonical revision must remain.
3. A pre-existing lock must cause a writer to fail without creating a canonical state.
4. Equal-timestamp (2000/2000) but different snapshots must also reject B.

The E216 negative-result test is promoted to a passing safety regression in the E217 branch. Run E213-E215 regressions to detect behavior changes. A green workflow establishes only these tested invariants.

## Important limitations

- This is **optimistic conflict rejection, not state merging**. Two independent clients with divergent full snapshots need an explicit merge/reload protocol.
- A crash can strand the lock directory, causing subsequent writes to fail closed until an operator verifies ownership and removes it. No automatic stale-lock reclamation is implemented.
- A successful rename is not proof of power-loss durability: no file/directory `fsync` protocol has been implemented.
- All participating writers must use this implementation. Old writers ignoring the lock can still race it.
- Full-revision equality does not eliminate ABA (a revision changed and later returned byte-for-byte to its prior value). A durable monotonic generation number is a future hardening step.
- In-memory state is optimistically updated before disk persistence; after a 409, restart/reload is required to reconcile state. Do not treat the rejected snapshot as durable.
- Tests run only on disposable HOME directories; no Chrome state, live bridge, or production data is modified.

## Next experiment

Inject a crash after lock acquisition and after temporary-file creation. Verify canonical data preservation, explicitly document safe manual recovery, then design a durable generation-based protocol and optional single-writer ownership for multi-client deployment.
