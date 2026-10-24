# E220 — rejected sync must not masquerade as committed MCP evidence

Date: 2026-10-24
Branch: `research/e220-rejected-sync-rollback-20261024`
Base: E219 draft PR #12; no merge or deployment.

## Hypothesis and falsification

E217–E219 reject stale cross-process writes and return HTTP 409 on revision
conflicts. But `createBridgeStore.updateSnapshot()` previously published the
new snapshot and `lastSyncAt` **before** awaiting persistence. If persistence
rejected, the API returned an error while MCP readers continued seeing the
uncommitted snapshot as current.

Falsifiable invariant: **after a rejected update promise settles, the visible
snapshot and timestamp must equal the last successfully persisted revision,
unless a newer queued update has subsequently been accepted.**

The isolated injected-persistence regression tested:
1. Rejected first sync after an existing committed snapshot.
2. Successful first queued sync followed by rejected second queued sync.
3. One-shot failure followed by a later successful sync.
4. Older queued failure followed by a newer successful sync.

Before the correction, cases 1 and 2 failed: the visible timestamps were
`202` instead of `101`, and `1002` instead of `1001`.
Case 3 already passed. The original failing evidence is preserved in
[red CI run 40105430042](https://github.com/stoicsatvik/Xtension/actions/runs/40105430042).
The failure occurred at the intended assertions, not a syntax/setup error.

## Correction

The store now records the newest queued revision ID. A rejected persistence
operation restores the snapshot and timestamp from the last committed
revision **only when it is still the newest queued update**. Older failures
cannot overwrite newer accepted work. Rollback also clears cached command
results and restores the committed command-state fingerprint conservatively.

The queue still survives individual failed writes. No cross-process CAS,
lock, revision UUID, browser permission, or Chrome command implementation was
relaxed.

## Validation

- [Initial green CI run 40105480044](https://github.com/stoicsatvik/Xtension/actions/runs/40105480044):
  first three E220 cases passed, E213–E215 persistence regressions passed,
  E217–E219 cross-process/crash regressions passed, syntax validation passed.
- The fourth E220 concurrency case was added afterward. Verify exact-head CI
  independently before claiming the full four-case result.

## Limitations and next falsification

This correction is **post-rejection rollback**, not full transactional
isolation. Pending snapshots can still be visible before their disk write
settles. An external process can change the canonical file while a bridge
continues serving its older committed in-memory snapshot until restart.
The browser client records 409 errors and keeps its original Chrome-local
evidence; it does not automatically reconcile competing bridge processes.

Next: separate committed from pending snapshots for all MCP read paths,
test HTTP 409 against two live local bridge instances with disposable HOME,
and ensure no command cache or client evidence is silently lost. Then evaluate
file and directory fsync with explicitly bounded durability claims.

All experiments use mocked persistence or disposable local state. No real
Chrome profile, user data, live bridge, merge, outreach, or deployment.
