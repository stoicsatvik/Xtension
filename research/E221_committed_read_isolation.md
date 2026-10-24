# E221 — MCP readers must see only committed bridge revisions

Date: 2026-10-24
Branch: `research/e221-committed-read-isolation-20261024`
Base: E220 draft PR #13. No merge or deployment.

## Hypothesis and falsifiable invariant

E220 restored the last committed snapshot *after* rejected writes, but
`updateSnapshot` still published its tentative snapshot and timestamp before
`persistSnapshot` finished. An MCP inventory read or `/health` call could
therefore report evidence that had not been persisted, even if the disk write
was subsequently rejected.

**Invariant:** `store.state.snapshot`, `store.state.lastSyncAt`, status
metadata, and command-cache invalidation advance only after the corresponding
persistence promise resolves successfully. With multiple queued writes,
readers observe each successful commit in order, not the newest accepted but
uncommitted revision.

The four deterministic injected-persistence tests cover:
1. Delayed successful write, with reads while the write is blocked.
2. Delayed rejected write, with reads both before and after rejection.
3. Two queued successful writes, with a read between their commits.
4. A completed command's dedupe cache while a new snapshot is pending and
   after that snapshot commits.

## Negative evidence

The unmodified E220 implementation failed the first three tests at their
intended visibility assertions: readers saw `unnecessary` instead of the
previously committed `essential` preference. The fourth test timed out because
tentative acceptance invalidated the cache and enqueued a command unexpectedly.
[Original red CI 40110165726](https://github.com/stoicsatvik/Xtension/actions/runs/40110165726)
preserves the failure. The test harness was then improved to avoid masking
that cache failure with a timeout and to handle an injected rejected promise
without an unhandled-rejection warning.

## Correction

`updateSnapshot` now constructs an isolated private revision and places it
in the existing serial persistence queue. It publishes `state.snapshot` and
`lastSyncAt` **only after** the underlying persist operation succeeds, and
invalidates cached command results only if the newly committed command-state
fingerprint changes. Rejections leave the committed state untouched and do
not poison subsequent queued writes. Initial state is also cloned to prevent
caller aliasing.

E214's older test previously mutated the *tentative* exposed state; after
this intentional contract change there is no tentative exposed state. That
regression was adapted to mutate the exposed **committed** state during a
blocked write, preserving its original independent-queued-revision isolation
assertions. An intermediate CI failure from this outdated test is retained in
[CI 40110230845](https://github.com/stoicsatvik/Xtension/actions/runs/40110230845).

## Validation

After adapting the inherited test, E221's four new tests passed and the
existing E213–E220 regression workflows were green at
[CI 40110281150](https://github.com/stoicsatvik/Xtension/actions/runs/40110281150)
and the six accompanying exact-head workflows on commit
`e22ad4f187db85ac9574e91ce13870a7ba0a93d9`.
Final exact-head CI must be rechecked after documentation commits.

## Limits and next falsification

These are in-process, deterministic injected-persistence tests, plus inherited
real-filesystem and independent-process regressions. They do not prove
linearizable reads across **different** bridge processes, because a process
does not reload another process's committed file without restart. The
`state` object remains mutable to in-process consumers; read-only exposure
is not enforced. Browser-side HTTP 409 reconciliation, filesystem fsync
durability, abandoned-lock recovery, and real Chrome worker lifecycle remain
unproven.

Next: run two live bridge instances with disposable HOME and explicit 409
reconciliation checks, then test whether clients preserve local unsynced
evidence. No real user Chrome state, deployed bridge, outreach, or main merge.
