# E215: Corrupt persisted bridge state must fail closed (2026-10-24)

## Question and predicted failure

E213 and E214 protect accepted revisions from in-process races, but what happens
after an interrupted or malformed write leaves `~/.xtension/state.json` invalid?
Before E215, `readPersistedState` caught **every** exception and silently
returned `{ lastSyncAt: 0, snapshot: {} }`. The next legitimate sync could
overwrite the damaged file, destroying forensic evidence and any recoverable
local state. The same silent reset occurred for permission/I/O failures.

**Falsifiable prediction:** A malformed JSON state and a well-formed JSON
`null` root both start as empty state rather than causing startup failure.
A genuinely absent state file must still initialize cleanly.

## Red phase (preserved)

Run: https://github.com/stoicsatvik/Xtension/actions/runs/40084706384
at commit `1f9b078083b0f711bb86471bdd011ee4fdc1f449`.

Four real-filesystem tests execute `readPersistedState` in separate Node
processes with disposable HOME directories. **2/4 passed, 2/4 failed.**

- Corrupted canonical JSON incorrectly produced empty state with exit code 0.
- A JSON `null` root likewise produced empty state with exit code 0.
- A genuinely missing canonical file initialized empty, as expected.
- An orphaned, partially written `.tmp` file did not override valid canonical
  state; the approved top-level keys were sanitized.

The failures are evidence of silent data-loss risk, not evidence of an
exploitable remote attack or actual user data loss.

## Correction

- Catch read errors separately; only `ENOENT` is treated as a new install.
- Reject malformed JSON and non-object/array roots with a descriptive error.
- Preserve corrupt on-disk bytes; do not overwrite, delete, or auto-repair.
- Let MCP startup fail visibly instead of accepting a fictitious blank state.
- Keep existing top-level evidence allowlist, in-process revision isolation and
  ordered persistence unchanged.

## Scope, safety and next falsification

All filesystem tests use disposable directories. No real Chrome extensions,
live home directory, production state, browser session or user data were touched.
This is **not** a durable fsync guarantee, transaction protocol, safe automatic
recovery, or multi-process write coordination. A second bridge process can still
overwrite a newer revision using stale in-memory state; `process.pid`-specific
temp filenames prevent temp-name collisions but not lost updates.

**Next experiment:** deterministically reproduce cross-process lost updates
using two isolated writers sharing a disposable state path. Evaluate a
single-writer lock or versioned compare-and-swap before implementing either.
Separately test simulated crash before/after rename and filesystem durability
semantics; do not infer them from this test.
